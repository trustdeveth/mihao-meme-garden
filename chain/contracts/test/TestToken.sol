// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice FOR TESTS ONLY. A plain token standing in for the one launched on Flap. It is never deployed by the tools.
contract TestToken is ERC20 {
    uint8 private immutable _places;

    constructor(address holder, uint8 places) ERC20("Test Mihao", "TMIHAO") {
        _places = places;
        _mint(holder, 1_000_000_000 * 10 ** places);
    }

    function decimals() public view override returns (uint8) {
        return _places;
    }
}
