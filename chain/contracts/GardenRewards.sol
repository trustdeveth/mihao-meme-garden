// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Meme Garden rewards, shop payments and Garden Club (gametokenomics.md sections 11 to 13)
/// @notice 1. Weekly reward pools. This contract holds a prefunded pool of MGRD. Each week the owner publishes one
/// Merkle root of finalized allocations (`openEpoch`). Players claim their fixed amount with a proof. Leaves are
/// bound to this chain, this contract, the token, the week, the leaf index and the wallet, so a proof cannot be
/// replayed. After the deadline the week is closed and what nobody claimed stays in the pool.
/// 2. Cosmetic orders. The server quotes an order (id and amount); the player pays with `payOrder`, which records a
/// receipt and splits the payment: `recycleBps` stays in the pool, the rest goes to the treasury. The server grants
/// the item only after reading that receipt.
/// 3. Garden Club. A player locks MGRD for some days and gets exactly the same amount back afterwards.
/// The token is launched separately (on Flap), so this contract can be deployed first: the owner names the token
/// with `setToken` ONCE, and it can never be changed. Until then nothing that moves tokens works.
/// @dev Pool and club tokens share this contract's balance. `totalLocked` marks the club part: nothing the owner or
/// a reward claim does can spend it. Invariant: balance - totalLocked >= unclaimed amount of all open weeks.
/// The contract is not upgradeable. There is no minting and no function that can take players' locked tokens.
contract GardenRewards is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_BPS = 10_000;
    uint16 public constant MAX_LOCK_DAYS = 365;
    uint256 public constant MAX_PROOF_LEN = 24; // up to 16 million leaves per week
    bytes32 public constant LEAF_DOMAIN = keccak256("MGRD-REWARD-V1");

    uint8 public constant TOKEN_DECIMALS = 18; // what the game counts in
    /// @notice The game token: zero until `setToken`, fixed afterwards. It must be a plain token (no fee on
    /// transfer, no rebasing).
    IERC20 public token;
    address public treasury;
    uint16 public recycleBps;
    bool public paused;
    /// @notice Sum of the totals of all open weeks (reserved pool funds).
    uint256 public outstanding;
    /// @notice Sum of all Garden Club locks.
    uint256 public totalLocked;

    struct Epoch {
        bytes32 root;
        uint256 total;
        uint256 claimed;
        uint64 claimDeadline;
        bool closed;
    }

    struct Order {
        uint256 amount;
        uint256 recycled;
        uint64 paidAt;
    }

    struct Lock {
        uint256 amount;
        uint64 lockedAt;
        uint64 unlockAt;
    }

    mapping(uint256 epochId => Epoch) public epochs;
    mapping(uint256 epochId => mapping(uint256 index => bool)) public isClaimed;
    /// @dev Keyed by the paying wallet as well as the order id, so nobody else can use up a player's order id.
    mapping(address payer => mapping(bytes16 orderId => Order)) public orders;
    mapping(address owner => Lock) public locks;

    event TokenSet(address token);
    event ConfigChanged(uint16 recycleBps, bool paused);
    event TreasuryChanged(address treasury);
    event EpochOpened(uint256 indexed epochId, bytes32 root, uint256 total, uint64 claimDeadline);
    event Claimed(uint256 indexed epochId, uint256 index, address indexed claimant, uint256 amount);
    event EpochClosed(uint256 indexed epochId, uint256 unclaimed);
    event OrderPaid(bytes16 indexed orderId, address indexed payer, uint256 amount, uint256 recycled);
    event ClubLocked(address indexed owner, uint256 amount, uint64 unlockAt);
    event ClubUnlocked(address indexed owner, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error BadBps();
    error BadToken();
    error TokenNotSet();
    error TokenAlreadySet();
    error FeeOnTransfer();
    error BadAddress();
    error BadDeadline();
    error ZeroAmount();
    error VaultUnderfunded();
    error Paused();
    error ProofTooLong();
    error EpochExists();
    error UnknownEpoch();
    error EpochIsClosed();
    error ClaimExpired();
    error NotExpired();
    error AlreadyClaimed();
    error BadProof();
    error Overdraw();
    error Reserved();
    error AlreadyPaid();
    error QuoteExpired();
    error BadLockDays();
    error StillLocked();
    error CannotRenounce();

    constructor(address treasury_, uint16 recycleBps_, address admin) Ownable(admin) {
        if (recycleBps_ > MAX_BPS) revert BadBps();
        _setTreasury(treasury_);
        recycleBps = recycleBps_;
        emit ConfigChanged(recycleBps_, false);
    }

    modifier whenTokenSet() {
        if (address(token) == address(0)) revert TokenNotSet();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    // ---- owner ---------------------------------------------------------------------------------------------

    /// @notice Name the game token. Works once: afterwards nobody, the owner included, can change it, so the owner
    /// can never swap it to get at players' locked tokens. Check the address with great care.
    function setToken(address token_) external onlyOwner {
        if (address(token) != address(0)) revert TokenAlreadySet();
        if (token_ == address(this) || token_.code.length == 0) revert BadToken();
        if (IERC20Metadata(token_).decimals() != TOKEN_DECIMALS) revert BadToken();
        token = IERC20(token_);
        emit TokenSet(token_);
    }

    /// @notice Change the recycle share or the pause switch.
    function updateConfig(uint16 recycleBps_, bool paused_) external onlyOwner {
        if (recycleBps_ > MAX_BPS) revert BadBps();
        recycleBps = recycleBps_;
        paused = paused_;
        emit ConfigChanged(recycleBps_, paused_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        _setTreasury(treasury_);
    }

    function _setTreasury(address treasury_) private {
        // paying the treasury must not land in the pool or the locks
        if (treasury_ == address(0) || treasury_ == address(this)) revert BadAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    /// @notice Disabled: giving up ownership by mistake would stop weekly pools for good.
    /// Handover is two steps (`transferOwnership`, then the new owner calls `acceptOwnership`).
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }

    /// @notice MGRD in the reward pool (the contract's balance without players' club locks).
    function poolBalance() public view returns (uint256) {
        if (address(token) == address(0)) return 0;
        return token.balanceOf(address(this)) - totalLocked;
    }

    /// @notice Publish a finalized weekly allocation. The pool must already hold enough for every open week.
    function openEpoch(uint256 epochId, bytes32 root, uint256 total, uint64 claimDeadline) external onlyOwner whenTokenSet {
        if (epochs[epochId].total != 0) revert EpochExists();
        if (claimDeadline <= block.timestamp) revert BadDeadline();
        if (total == 0) revert ZeroAmount();
        uint256 needed = outstanding + total;
        if (poolBalance() < needed) revert VaultUnderfunded();
        outstanding = needed;
        epochs[epochId] = Epoch(root, total, 0, claimDeadline, false);
        emit EpochOpened(epochId, root, total, claimDeadline);
    }

    /// @notice After the deadline: stop claims and release the week's reservation.
    function closeEpoch(uint256 epochId) external onlyOwner {
        Epoch storage e = epochs[epochId];
        if (e.total == 0) revert UnknownEpoch();
        if (e.closed) revert EpochIsClosed();
        if (block.timestamp <= e.claimDeadline) revert NotExpired();
        e.closed = true;
        outstanding -= e.total;
        emit EpochClosed(epochId, e.total - e.claimed);
    }

    /// @notice Move pool tokens that no open week needs. Never touches reserved funds or club locks.
    function withdrawUnreserved(address to, uint256 amount) external onlyOwner whenTokenSet nonReentrant {
        uint256 pool = poolBalance();
        uint256 free = pool > outstanding ? pool - outstanding : 0;
        if (amount > free) revert Reserved();
        emit Withdrawn(to, amount);
        token.safeTransfer(to, amount);
    }

    // ---- players -------------------------------------------------------------------------------------------

    /// @notice Leaf of the weekly reward tree. Hashed twice so an inner node can never be passed off as a leaf.
    function leafHash(uint256 epochId, uint256 index, address claimant, uint256 amount) public view returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(abi.encode(LEAF_DOMAIN, block.chainid, address(this), address(token), epochId, index, claimant, amount))
            )
        );
    }

    /// @notice Claim one weekly allocation. Anyone may send the transaction (for example to pay the fee for a
    /// player); the tokens always go to `claimant`, the wallet written into the proof.
    function claim(uint256 epochId, uint256 index, address claimant, uint256 amount, bytes32[] calldata proof)
        external
        whenTokenSet
        whenNotPaused
        nonReentrant
    {
        if (proof.length > MAX_PROOF_LEN) revert ProofTooLong();
        if (amount == 0) revert ZeroAmount();
        Epoch storage e = epochs[epochId];
        if (e.total == 0) revert UnknownEpoch();
        if (e.closed) revert EpochIsClosed();
        if (block.timestamp > e.claimDeadline) revert ClaimExpired();
        if (isClaimed[epochId][index]) revert AlreadyClaimed();
        if (!MerkleProof.verifyCalldata(proof, e.root, leafHash(epochId, index, claimant, amount))) revert BadProof();
        uint256 claimed = e.claimed + amount;
        if (claimed > e.total) revert Overdraw();
        e.claimed = claimed;
        isClaimed[epochId][index] = true;
        emit Claimed(epochId, index, claimant, amount);
        token.safeTransfer(claimant, amount);
    }

    /// @notice Pay for one quoted cosmetic order (approve this contract for the amount first). One payment per
    /// order id and wallet. A payment sent after the quote's `deadline` is refused, so nobody pays for a quote the
    /// game would no longer honour (for example after leaving the wallet window open).
    function payOrder(bytes16 orderId, uint256 amount, uint64 deadline) external whenTokenSet whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert QuoteExpired();
        if (orders[msg.sender][orderId].paidAt != 0) revert AlreadyPaid();
        uint256 recycle = (amount * recycleBps) / MAX_BPS;
        orders[msg.sender][orderId] = Order(amount, recycle, uint64(block.timestamp));
        emit OrderPaid(orderId, msg.sender, amount, recycle);
        if (recycle > 0) token.safeTransferFrom(msg.sender, address(this), recycle);
        if (amount > recycle) token.safeTransferFrom(msg.sender, treasury, amount - recycle);
    }

    /// @notice Garden Club: lock MGRD for `lockDays` (approve first). Topping up adds to the lock and can only push
    /// the unlock date later. No interest is paid.
    function clubLock(uint256 amount, uint16 lockDays) external whenTokenSet whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (lockDays < 1 || lockDays > MAX_LOCK_DAYS) revert BadLockDays();
        Lock storage l = locks[msg.sender];
        uint64 until = uint64(block.timestamp + uint256(lockDays) * 1 days);
        if (l.amount == 0) {
            l.lockedAt = uint64(block.timestamp);
            l.unlockAt = until;
        } else if (until > l.unlockAt) {
            l.unlockAt = until;
        }
        l.amount += amount;
        totalLocked += amount;
        emit ClubLocked(msg.sender, l.amount, l.unlockAt);
        // if a transfer tax kept part of it, the contract could not give everyone's tokens back: refuse the lock
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != before + amount) revert FeeOnTransfer();
    }

    /// @notice Get all locked MGRD back once the unlock date has passed. Works even while paused.
    function clubUnlock() external nonReentrant {
        Lock storage l = locks[msg.sender];
        uint256 amount = l.amount;
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp < l.unlockAt) revert StillLocked();
        l.amount = 0;
        totalLocked -= amount;
        emit ClubUnlocked(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }
}
