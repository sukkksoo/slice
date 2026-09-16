// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {Currency} from "v4-core/types/Currency.sol";

/// @title ArcChain
/// @notice Canonical Arc (chain id 5042) addresses and the USDC dual-representation invariant.
/// @dev Arc pays gas in USDC. The native asset carries 18 decimals; the canonical ERC-20
///      interface at `USDC_ERC20` exposes the *same balance* with 6 decimals. Mixing the two
///      representations is a 1e12 error, so every conversion in this protocol routes through
///      `to6` / `from6` rather than touching raw amounts.
library ArcChain {
    uint256 internal constant CHAIN_ID = 5042;
    uint256 internal constant TESTNET_CHAIN_ID = 5042002;

    /// @notice Canonical 6-decimal ERC-20 interface to Arc's native USDC.
    address internal constant USDC_ERC20 = 0x3600000000000000000000000000000000000000;

    /// @notice Scale factor between the 18-decimal native representation and the 6-decimal ERC-20.
    uint256 internal constant USDC_SCALE = 1e12;

    // --- Uniswap v4 (Arc mainnet) ---
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant POSITION_MANAGER = 0x6049c9a0e26405C0985f9E3685C87d0aE917f82B;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant QUOTER = 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94;
    address internal constant UNIVERSAL_ROUTER = 0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    error NotUsdc();

    /// @notice True if `c` is either representation of Arc USDC (native or 6-decimal ERC-20).
    function isUsdc(Currency c) internal pure returns (bool) {
        address a = Currency.unwrap(c);
        return a == address(0) || a == USDC_ERC20;
    }

    /// @notice True if `c` is the 18-decimal native representation.
    function isNativeUsdc(Currency c) internal pure returns (bool) {
        return Currency.unwrap(c) == address(0);
    }

    /// @notice Normalise a raw amount of USDC currency `c` to 6-decimal accounting units.
    function to6(Currency c, uint256 amount) internal pure returns (uint256) {
        address a = Currency.unwrap(c);
        if (a == address(0)) return amount / USDC_SCALE;
        if (a == USDC_ERC20) return amount;
        revert NotUsdc();
    }

    /// @notice Expand a 6-decimal accounting amount back into the raw units of currency `c`.
    function from6(Currency c, uint256 amount6) internal pure returns (uint256) {
        address a = Currency.unwrap(c);
        if (a == address(0)) return amount6 * USDC_SCALE;
        if (a == USDC_ERC20) return amount6;
        revert NotUsdc();
    }
}
