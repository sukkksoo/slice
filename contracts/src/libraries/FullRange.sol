// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";

/// @title FullRange
/// @notice Tick-range helpers for vaults that hold a single full-range position.
library FullRange {
    /// @notice The widest tick range that is valid for `tickSpacing`.
    /// @dev Solidity truncates toward zero, so `MIN_TICK / s * s >= MIN_TICK` and
    ///      `MAX_TICK / s * s <= MAX_TICK`; both results are therefore usable ticks.
    function ticks(int24 tickSpacing) internal pure returns (int24 lower, int24 upper) {
        // forge-lint: disable-next-line(divide-before-multiply)
        lower = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
        // forge-lint: disable-next-line(divide-before-multiply)
        upper = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
    }

    /// @notice Token amounts represented by `liquidity` over [tickLower, tickUpper] at `sqrtPriceX96`.
    /// @param roundUp Round in the protocol's favour: true when computing what a depositor owes,
    ///        false when computing what a withdrawer receives.
    function amountsForLiquidity(
        uint160 sqrtPriceX96,
        uint160 sqrtPriceLowerX96,
        uint160 sqrtPriceUpperX96,
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        if (liquidity == 0) return (0, 0);
        if (sqrtPriceX96 <= sqrtPriceLowerX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceLowerX96, sqrtPriceUpperX96, liquidity, roundUp);
        } else if (sqrtPriceX96 < sqrtPriceUpperX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtPriceUpperX96, liquidity, roundUp);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtPriceLowerX96, sqrtPriceX96, liquidity, roundUp);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtPriceLowerX96, sqrtPriceUpperX96, liquidity, roundUp);
        }
    }
}
