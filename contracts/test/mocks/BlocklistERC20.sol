// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice An ERC-20 that refuses transfers touching a blocked address.
///
/// @dev Models the part of Arc's USDC that matters for protocol safety. The real token is a thin
///      wrapper over two chain precompiles — a compliance check at 0x1800…0001 and a native
///      balance move at 0x1800…0000 — neither of which exists in Foundry's EVM, so the real
///      contract cannot execute a transfer in a fork. What it *can* do is revert for a blocklisted
///      party, and that is the behaviour the protocol has to survive. This mock reproduces exactly
///      that, so the freeze-resistance regression test is deterministic and runs offline.
contract BlocklistERC20 is ERC20 {
    uint8 private immutable _decimals;
    mapping(address => bool) public blocked;

    error Blocklisted(address account);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[from]) revert Blocklisted(from);
        if (blocked[to]) revert Blocklisted(to);
        super._update(from, to, value);
    }
}
