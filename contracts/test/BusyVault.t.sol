// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Test.sol";

import {SliceTestBase} from "./Base.t.sol";

/// @notice What traffic does to the oracle.
///
/// The ring holds a fixed 32 observations and `tryConsult` will not answer until they span the
/// vault's 30-minute window. Nothing rations who may add one: `poke` is permissionless by design,
/// and deposit, withdraw, harvest and compound all poke on the way through. So the question this
/// asks is whether a vault can overwrite its own history simply by being used — and, separately,
/// whether two keepers can do the same thing to a quiet one.
///
/// Both matter more than they look. A cold oracle is not an error anybody sees: single-sided
/// deposits start refusing, compounding stops, harvests defer the token side, and every log in the
/// system reports healthy rounds.
contract BusyVaultTest is SliceTestBase {
    /// @dev Warm the ring the way a keeper at 90 seconds does.
    function _warmProperly() internal {
        for (uint256 i = 0; i < 34; i++) {
            vault.poke();
            vm.warp(block.timestamp + 90);
        }
    }

    function _warm() internal view returns (bool ok) {
        (ok,,) = vault.prices();
    }

    /// @notice A vault that is merely popular must not lose its oracle.
    function test_trafficDoesNotCoolTheOracle() public {
        _seed(alice, 10_000e6, 10_000e18);
        _warmProperly();
        assertTrue(_warm(), "oracle should be warm before the traffic starts");

        // Forty transactions over twenty minutes: one every thirty seconds. Busy, not absurd —
        // and fewer than the ring holds is not the bar, because every one of them pokes.
        for (uint256 i = 0; i < 40; i++) {
            vm.warp(block.timestamp + 30);
            vault.poke();
        }

        console2.log("warm after 40 pokes in 20 minutes:", _warm());
        assertTrue(
            _warm(),
            "a busy vault poked itself cold: 32 slots overwritten inside the averaging window"
        );
    }

    /// @notice And real traffic, rather than bare pokes, does the same thing through the same door.
    function test_depositsAndWithdrawalsDoNotCoolTheOracle() public {
        _seed(alice, 10_000e6, 10_000e18);
        _warmProperly();
        assertTrue(_warm(), "oracle should be warm before the traffic starts");

        for (uint256 i = 0; i < 20; i++) {
            vm.warp(block.timestamp + 45);
            uint256 shares = _seed(bob, 100e6, 100e18);
            vm.warp(block.timestamp + 45);
            vm.prank(bob);
            vault.withdraw(shares, 0, 0, bob);
        }

        console2.log("warm after 20 deposit/withdraw pairs:", _warm());
        assertTrue(_warm(), "ordinary traffic cooled the oracle");
    }

    /// @notice Two keepers must not be worse than one.
    ///
    /// They are, without a spacing floor: each poke consumes a slot, so doubling the callers
    /// halves the span the same 32 slots cover. Whoever starts the second one sees two healthy
    /// logs and a vault that has quietly stopped accepting single-sided deposits.
    function test_twoKeepersDoNotCoolTheOracle() public {
        _seed(alice, 10_000e6, 10_000e18);
        _warmProperly();
        assertTrue(_warm(), "oracle should be warm before the second keeper starts");

        // Two keepers at 90s, interleaved: a poke every 45 seconds.
        for (uint256 i = 0; i < 40; i++) {
            vm.warp(block.timestamp + 45);
            vault.poke();
        }

        console2.log("warm with two keepers:", _warm());
        assertTrue(_warm(), "a second keeper cooled the oracle it was meant to help");
    }
}
