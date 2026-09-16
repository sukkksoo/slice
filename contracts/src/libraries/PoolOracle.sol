// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

/// @title PoolOracle
/// @notice A self-recorded, time-weighted sqrt-price accumulator.
///
/// @dev Uniswap v4 moved oracles out of the core pool and into hooks, so a protocol that wants a
///      manipulation-resistant price for a pool it does not own has to accumulate its own. Every
///      permissionless `poke` records an observation; automated actions then require that the
///      recorded window is long enough AND that spot has not diverged from the TWAP.
///
/// @dev The accumulator credits the *previously observed* price across the interval it was
///      actually held, then stores the new price for the next interval — the same shape as
///      Uniswap's own oracles. Crediting the price observed *now* across the interval that has
///      already elapsed would be a serious flaw: `poke` is permissionless, so after a quiet gap an
///      attacker could flash-manipulate the price, poke, and backdate that price across the whole
///      gap in a single transaction. As written, a manipulated price only reaches the average if
///      the attacker holds it until somebody pokes again, which is the cost we want to impose.
library PoolOracle {
    /// @notice Number of retained observations. 32 slots at, say, 5-minute pokes spans ~2.6h.
    uint256 internal constant CARDINALITY = 32;

    struct Snapshot {
        uint32 timestamp;
        uint224 cumulative; // sum of sqrtPriceX96 * secondsHeld
    }

    struct Oracle {
        uint32 lastTimestamp;
        /// @dev The price seen at `lastTimestamp`, not yet credited to the accumulator. It is
        ///      credited on the next `record`, weighted by how long it actually stood.
        uint160 lastSqrtPriceX96;
        uint224 cumulative;
        uint16 index; // next slot to write
        uint16 count; // populated slots, saturating at CARDINALITY
        Snapshot[32] ring;
    }

    error WindowTooShort();

    /// @notice Fold the elapsed interval into the accumulator and latch `sqrtPriceX96` for the next.
    /// @dev A no-op when called twice in the same second, which keeps same-block spam from
    ///      consuming ring slots and shrinking the effective averaging window. The latched price is
    ///      also left alone in that case, so the first price seen in a second is the one that
    ///      counts and a same-block sandwich cannot overwrite it.
    function record(Oracle storage self, uint160 sqrtPriceX96) internal {
        uint32 nowTs = uint32(block.timestamp);
        uint32 last = self.lastTimestamp;

        if (last == 0) {
            self.lastTimestamp = nowTs;
            self.lastSqrtPriceX96 = sqrtPriceX96;
            self.ring[0] = Snapshot({timestamp: nowTs, cumulative: 0});
            self.index = 1;
            self.count = 1;
            return;
        }

        uint32 elapsed = nowTs - last;
        if (elapsed == 0) return;

        uint224 next;
        unchecked {
            // The *previous* price, across the interval it was actually held.
            next = self.cumulative + uint224(uint256(self.lastSqrtPriceX96) * elapsed);
        }
        self.cumulative = next;
        self.lastTimestamp = nowTs;
        self.lastSqrtPriceX96 = sqrtPriceX96;

        uint16 i = self.index;
        self.ring[i] = Snapshot({timestamp: nowTs, cumulative: next});
        self.index = uint16((uint256(i) + 1) % CARDINALITY);
        if (self.count < CARDINALITY) self.count = self.count + 1;
    }

    /// @notice Mean sqrt price over the longest recorded window of at least `minWindow` seconds.
    /// @return ok False when the accumulator does not yet span `minWindow`.
    /// @dev Non-reverting so that callers on a user-facing path (a harvest, say) can degrade
    ///      gracefully instead of bricking while the oracle is still warming up.
    function tryConsult(Oracle storage self, uint32 minWindow)
        internal
        view
        returns (bool ok, uint160 twapSqrtPriceX96)
    {
        uint16 count = self.count;
        if (count < 2) return (false, 0);

        uint32 newestTs = self.lastTimestamp;
        uint224 newestCum = self.cumulative;

        // Walk from the OLDEST observation forward and take the first that spans `minWindow`. The
        // oldest qualifying entry gives the longest averaging window, which is the most expensive
        // one for an attacker to hold a dislocated price across. Walking the other way would
        // return the shortest qualifying window instead — cheaper to manipulate.
        uint256 oldest = count == CARDINALITY ? self.index : 0;

        for (uint256 n = 0; n + 1 < count; n++) {
            Snapshot memory s = self.ring[(oldest + n) % CARDINALITY];
            if (s.timestamp == 0) continue;

            uint32 window = newestTs - s.timestamp;
            if (window >= minWindow) {
                // casting to 'uint160' is safe because the quotient is a time-weighted mean of
                // sqrtPriceX96 samples, each itself a uint160, so the mean cannot exceed the max
                // forge-lint: disable-next-line(unsafe-typecast)
                return (true, uint160(uint256(newestCum - s.cumulative) / window));
            }
        }
        return (false, 0);
    }

    /// @notice As `tryConsult`, but reverts when no sufficiently long window exists.
    function consult(Oracle storage self, uint32 minWindow) internal view returns (uint160) {
        (bool ok, uint160 twap) = tryConsult(self, minWindow);
        if (!ok) revert WindowTooShort();
        return twap;
    }

    /// @notice Absolute deviation of `spot` from `twap`, in basis points of `twap`.
    function deviationBps(uint160 spot, uint160 twap) internal pure returns (uint256) {
        if (twap == 0) return type(uint256).max;
        uint256 diff = spot > twap ? uint256(spot) - twap : uint256(twap) - spot;
        return (diff * 10_000) / twap;
    }
}
