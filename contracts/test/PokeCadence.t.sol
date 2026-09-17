// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PoolOracle} from "../src/libraries/PoolOracle.sol";

/// @notice How often a keeper pokes decides both whether the oracle ever warms and how closely
///         its TWAP tracks spot. Neither is obvious from the library, and both are operational
///         settings someone has to choose before running a keeper.
contract PokeCadenceTest is Test {
    using PoolOracle for PoolOracle.Oracle;

    PoolOracle.Oracle internal oracle;

    uint32 constant MIN_WINDOW = 30 minutes;
    uint160 constant PRICE = 1 << 96;

    /// @dev Poke every `interval` seconds for `rounds`, then report the window tryConsult returns.
    function _run(uint32 interval, uint256 rounds) internal returns (bool ok, uint32 window) {
        delete oracle;
        for (uint256 i; i < rounds; i++) {
            oracle.record(PRICE);
            vm.warp(block.timestamp + interval);
        }
        oracle.record(PRICE);
        (ok,) = oracle.tryConsult(MIN_WINDOW);
        // Recover the window the same way tryConsult does, for reporting.
        window = ok ? interval * uint32(oracle.count - 1) : 0;
    }

    /// @notice Poking faster than the ring can span 30 minutes leaves the oracle permanently cold.
    ///
    /// @dev The ring holds 32 observations, so a full ring spans only 31 intervals. At 30-second
    ///      pokes that is 15.5 minutes — short of MIN_TWAP_WINDOW — and every older observation
    ///      has already been overwritten. The oracle never warms no matter how long it runs, which
    ///      is the opposite of what "poke more often to be safe" would lead a keeper to expect.
    /// @notice Poking faster than the oracle retains is harmless, where it used to be fatal.
    ///
    /// This test used to assert the opposite, because the opposite was true: every poke consumed
    /// a ring slot, so a caller at 30 or 15 seconds overwrote 32 slots well inside the 30-minute
    /// window and `tryConsult` never answered again. That was not a hypothetical misconfiguration
    /// — deposits, withdrawals and harvests all poke, so any vault with traffic did it to itself,
    /// and a second keeper did it to a quiet one.
    ///
    /// PoolOracle.MIN_SPACING now puts a floor under how often an observation is retained. The
    /// extra pokes still advance the accumulator, so they cost nothing in accuracy; they simply
    /// do not spend a slot. Nobody can cool a vault's oracle by calling a permissionless function
    /// too enthusiastically.
    function test_pokingTooFastIsHarmless() public {
        (bool ok,) = _run(30, 200);
        assertTrue(ok, "30s pokes should still warm: the extra ones are not retained");

        (ok,) = _run(15, 400);
        assertTrue(ok, "15s pokes should still warm");

        (ok,) = _run(1, 4_000);
        assertTrue(ok, "even a poke a second should warm");
    }

    /// @notice Just above 58 seconds the full ring clears the window and the oracle warms.
    /// @notice The retained cadence is what sets the window, not the calling cadence.
    ///
    /// 58-second calls used to leave a full ring spanning 1798 seconds — two seconds short of the
    /// window, and therefore permanently cold. With a spacing floor the retained gaps are at
    /// least a minute whatever the caller does, so both of these warm.
    function test_theWindowNoLongerDependsOnTheCallersCadence() public {
        (bool ok,) = _run(58, 200);
        assertTrue(ok, "58s calls should warm now that retention is spaced independently");

        (ok,) = _run(60, 200);
        assertTrue(ok, "60s x 31 = 1860s, comfortably over");

        (ok,) = _run(300, 200);
        assertTrue(ok, "a slow keeper still warms; the window is just wider");
    }

    /// @notice The averaging window grows with the interval, so a slow keeper averages over hours.
    ///
    /// @dev This is what decides whether the vault's swaps actually execute: `maxDeviationBps`
    ///      compares spot against this average, so the longer the window the more a volatile token
    ///      drifts outside the band and the more often harvests defer.
    function test_windowScalesWithInterval() public {
        uint32[4] memory intervals = [uint32(60), 90, 300, 600];
        for (uint256 i; i < intervals.length; i++) {
            (bool ok, uint32 window) = _run(intervals[i], 200);
            assertTrue(ok, "should be warm");
            console2.log("interval (s)", intervals[i]);
            console2.log("  window (min)", window / 60);
        }
    }
}
