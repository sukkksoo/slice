// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PoolOracle} from "../src/libraries/PoolOracle.sol";

/// @notice How long a brand new vault takes to become usable, at a given keeper cadence.
///
/// This is the number a person actually feels when they list a pool, so it is worth measuring
/// rather than estimating. Two separate moments matter and they are not the same: when the oracle
/// will answer at all, and when its averaging window stops growing.
contract WarmupTimingTest is Test {
    using PoolOracle for PoolOracle.Oracle;

    PoolOracle.Oracle internal o;
    uint32 constant MIN_WINDOW = 30 minutes;
    uint160 constant PRICE = uint160(1 << 96);

    function _measure(uint32 interval) internal returns (uint256 warmAt, uint256 settledAt) {
        delete o;
        uint256 t0 = block.timestamp;
        uint32 lastWindow = 0;

        for (uint256 i = 0; i < 80; i++) {
            o.record(PRICE);
            (bool ok,) = o.tryConsult(MIN_WINDOW);
            if (ok && warmAt == 0) warmAt = block.timestamp - t0;

            // The window grows while the ring fills, then stops once it wraps.
            if (ok) {
                uint32 w = interval * uint32(o.count - 1);
                if (w == lastWindow && settledAt == 0) settledAt = block.timestamp - t0;
                lastWindow = w;
            }
            vm.warp(block.timestamp + interval);
        }
    }

    function test_howLongUntilANewPoolIsUsable() public {
        uint32[3] memory cadences = [uint32(60), 90, 120];
        for (uint256 i; i < cadences.length; i++) {
            (uint256 warmAt, uint256 settledAt) = _measure(cadences[i]);
            console2.log("keeper interval (s)   ", cadences[i]);
            console2.log("  usable after (min)  ", warmAt / 60);
            console2.log("  window settles (min)", settledAt / 60);
        }
    }
}
