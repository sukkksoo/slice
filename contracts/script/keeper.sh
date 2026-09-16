#!/usr/bin/env bash
# Keep every vault's price oracle warm, and harvest when there is something to harvest.
#
#   PRIVATE_KEY=<key> ./script/keeper.sh [--once]
#
# WHY THIS IS NEEDED
#
# The vault accumulates its own TWAP, because Uniswap v4 moved oracles out of the pool and into
# hooks and the vault does not own the pools it serves. `poke()` records one observation. Until
# the recorded window spans MIN_TWAP_WINDOW (30 minutes), the vault will not price an internal
# swap, so single-sided deposits revert and harvests defer the token side of collected fees.
#
# Nothing about this is privileged: `poke` and `harvest` are permissionless and neither lets the
# caller redirect a cent. Anyone can run this. It costs gas and nothing else.
#
# Poke more often than you think: the averaging window is only as long as the oldest retained
# observation, the ring holds 32, and a same-second poke is a no-op. Every 5 minutes fills the
# ring across ~2.6 hours, which is comfortably more than the 30-minute minimum.
set -euo pipefail

RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
FACTORY="${SLICE_FACTORY:-0x219DF226816e4CCcAAF8C7fAB7469837e857c05b}"
INTERVAL="${KEEPER_INTERVAL:-300}"
: "${PRIVATE_KEY:?set PRIVATE_KEY}"
case "$PRIVATE_KEY" in 0x*) ;; *) PRIVATE_KEY="0x$PRIVATE_KEY";; esac

ONCE=false
[ "${1:-}" = "--once" ] && ONCE=true

send() { cast send "$@" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null 2>&1; }
call() { cast call "$@" --rpc-url "$RPC" 2>/dev/null | head -1 | sed 's/ \[.*//'; }

round() {
  local count vault warm pending
  count=$(call "$FACTORY" "vaultCount()(uint256)")
  [ -n "$count" ] || { echo "$(date -u +%T) cannot reach the factory"; return; }

  for ((i = 0; i < count; i++)); do
    vault=$(call "$FACTORY" "allVaults(uint256)(address)" "$i")
    [ -n "$vault" ] || continue

    if send "$vault" "poke()"; then :; else
      echo "$(date -u +%T) $vault poke failed"
      continue
    fi

    warm=$(call "$vault" "prices()(bool,uint160,uint160)" | head -1)

    # Harvest only once the oracle can price the swap. Calling it cold still works — it simply
    # defers the token side — but it burns gas to move fees from one pending bucket to another.
    pending=$(call "$vault" "pendingAssetFees()(uint256)")
    if [ "$warm" = "true" ]; then
      send "$vault" "harvest()" || true
      echo "$(date -u +%T) $vault poked, warm, harvested"
    else
      echo "$(date -u +%T) $vault poked, still warming (deferred fees: ${pending:-0})"
    fi
  done
}

echo "keeper: factory $FACTORY on $RPC, every ${INTERVAL}s"
round
$ONCE && exit 0
while true; do
  sleep "$INTERVAL"
  round
done
