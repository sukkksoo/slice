// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolOracle} from "../src/libraries/PoolOracle.sol";

/// @notice Exposes the library so its storage behaviour can be driven directly.
contract OracleHarness {
    using PoolOracle for PoolOracle.Oracle;

    PoolOracle.Oracle internal oracle;

    function record(uint160 sqrtPriceX96) external {
        oracle.record(sqrtPriceX96);
    }

    function tryConsult(uint32 minWindow) external view returns (bool, uint160) {
        return oracle.tryConsult(minWindow);
    }
}

/// @notice The oracle is the only thing standing between an automated swap and a manipulated
///         price, so its weighting and window selection are pinned here directly.
contract OracleTest is Test {
    uint32 constant WINDOW = 30 minutes;

    OracleHarness oracle;

    function setUp() public {
        oracle = new OracleHarness();
        vm.warp(1_000_000);
    }

    function _poke(uint160 price, uint32 advance) internal {
        vm.warp(block.timestamp + advance);
        oracle.record(price);
    }

    /// @notice The headline property: a price is only averaged in for as long as it is held.
    ///
    /// @dev `poke` is permissionless. If the accumulator credited the price observed *now* across
    ///      the interval that already elapsed, an attacker could wait for a quiet gap, flash the
    ///      price in one transaction, poke, and backdate the manipulation across the whole gap.
    function test_flashManipulatedPokeBarelyMovesTheAverage() public {
        uint160 fair = 79_228_162_514_264_337_593_543_950_336; // 1:1 in Q96

        // An hour of honest price, sampled every five minutes.
        oracle.record(fair);
        for (uint256 i = 0; i < 12; i++) _poke(fair, 5 minutes);

        (bool ok, uint160 before) = oracle.tryConsult(WINDOW);
        assertTrue(ok, "oracle did not warm");
        assertEq(before, fair, "baseline should be the fair price");

        // Attacker flashes the price 100x and pokes in the same transaction. No time passes while
        // the manipulated price is standing.
        oracle.record(fair * 100);

        (bool ok2, uint160 after_) = oracle.tryConsult(WINDOW);
        assertTrue(ok2, "oracle went cold");
        assertEq(after_, before, "a zero-duration price moved the average");
    }

    /// @notice A latched price counts for the interval that follows it — the residual cost.
    ///
    /// @dev This is the flip side of crediting the previous price: whatever was latched at the
    ///      last poke is credited across the gap until the next one, regardless of what the price
    ///      did in between. It is the same property Uniswap's own oracles have, and it is bounded
    ///      by how often somebody pokes. What it cannot do — and what the old code allowed — is
    ///      rewrite the window that has *already* passed.
    function test_aLatchedPriceCountsForTheFollowingInterval() public {
        uint160 fair = 79_228_162_514_264_337_593_543_950_336;

        oracle.record(fair);
        for (uint256 i = 0; i < 12; i++) _poke(fair, 5 minutes);
        (, uint160 before) = oracle.tryConsult(WINDOW);

        // Latch an elevated price (a second later, so the same-second guard does not swallow it),
        // then let five minutes pass before the next sample.
        _poke(fair * 2, 1);
        _poke(fair, 5 minutes);

        (, uint160 after_) = oracle.tryConsult(WINDOW);
        assertGt(after_, before, "a latched price should count for the interval that follows it");
    }

    /// @notice Poking promptly after a manipulation limits how much of it lands.
    /// @dev The defence against the residual above is sampling frequency, and it is available to
    ///      anyone: `poke` is permissionless, so an honest keeper can cut the interval short.
    function test_promptPokingLimitsTheDamage() public {
        uint160 fair = 79_228_162_514_264_337_593_543_950_336;

        oracle.record(fair);
        for (uint256 i = 0; i < 12; i++) _poke(fair, 5 minutes);
        (, uint160 baseline) = oracle.tryConsult(WINDOW);

        // Same manipulation, but a keeper pokes one second later instead of five minutes.
        _poke(fair * 2, 1);
        _poke(fair, 1);
        (, uint160 promptlyPoked) = oracle.tryConsult(WINDOW);

        assertApproxEqRel(
            promptlyPoked, baseline, 0.001e18, "prompt poking should keep the average near fair"
        );
    }

    /// @notice The longest qualifying window is chosen, not the shortest.
    /// @dev Walking newest-to-oldest returns the youngest entry that merely clears `minWindow`,
    ///      which is the cheapest window for an attacker to hold a price across.
    function test_consultUsesTheLongestQualifyingWindow() public {
        uint160 fair = 79_228_162_514_264_337_593_543_950_336;

        // A long stretch at the fair price, then a recent stretch at double.
        oracle.record(fair);
        for (uint256 i = 0; i < 12; i++) _poke(fair, 5 minutes);
        for (uint256 i = 0; i < 6; i++) _poke(fair * 2, 5 minutes);

        (bool ok, uint160 twap) = oracle.tryConsult(WINDOW);
        assertTrue(ok, "oracle went cold");

        // Averaging over the *shortest* qualifying window would sit at roughly 2x, because the
        // recent half-hour is all elevated. The longest window dilutes it with the earlier hour.
        assertLt(twap, fair * 2, "average is dominated by the recent elevated stretch");
        assertGt(twap, fair, "average should still be above the old fair price");
    }

    function test_reportsColdUntilTheWindowIsSpanned() public {
        uint160 fair = 79_228_162_514_264_337_593_543_950_336;

        oracle.record(fair);
        _poke(fair, 10 minutes);

        (bool ok,) = oracle.tryConsult(WINDOW);
        assertFalse(ok, "ten minutes should not satisfy a thirty-minute window");

        _poke(fair, 25 minutes);
        (bool ok2,) = oracle.tryConsult(WINDOW);
        assertTrue(ok2, "thirty-five minutes should satisfy it");
    }

    function test_sameSecondPokesAreIgnored() public {
        uint160 fair = 79_228_162_514_264_337_593_543_950_336;

        oracle.record(fair);
        for (uint256 i = 0; i < 12; i++) _poke(fair, 5 minutes);
        (, uint160 before) = oracle.tryConsult(WINDOW);

        // Spamming within one second must not consume ring slots or shift the average.
        for (uint256 i = 0; i < 40; i++) oracle.record(fair * 50);

        (bool ok, uint160 after_) = oracle.tryConsult(WINDOW);
        assertTrue(ok, "spam collapsed the window");
        assertEq(after_, before, "same-second spam moved the average");
    }
}
