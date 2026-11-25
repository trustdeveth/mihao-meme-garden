// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice FOR TESTS ONLY. Keeps 5% of every transfer, to check the Garden Club refuses such a token.
contract TaxToken is ERC20 {
    constructor(address holder) ERC20("Taxed", "TAX") {
        _mint(holder, 1_000_000e18);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 20;
            super._update(from, address(0xdead), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}
