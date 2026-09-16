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
# CHOOSING THE INTERVAL — it is not "as often as possible"
#
# The oracle ring holds 32 observations, so a full ring spans only 31 intervals, and the TWAP
# is taken over that whole span. Both ends of the range bite:
#
#   15s, 30s  ring spans under 30 minutes -> tryConsult never returns a price. The oracle
#             stays cold forever, however long the keeper runs. Poking harder makes it worse.
#   60s       31-minute window. Warm, with a minute of margin.
#   90s       46-minute window.  <-- the default
#   300s      155-minute window. Warm, but the vault compares spot against a 2.5-hour average,
#             and with maxDeviationBps at 1% a volatile token sits outside the band most of
#             the time, so swaps and harvests keep deferring.
#
# test/PokeCadence.t.sol pins all of this.
#
# WHAT IT COSTS, AND WHEN IT IS WORTH RUNNING
#
# A poke is ~67k gas, about 0.3 cents at 44 gwei — but it repeats forever, so the interval is
# the bill: roughly 85 USDC a month at 90s, 26 at 5 minutes, 13 at 10 minutes.
#
# Deposits, withdrawals, harvests and compounds all call poke() themselves, so a vault with
# real traffic feeds its own oracle and the keeper only covers quiet stretches. A vault with
# no deposits has nothing to harvest and nobody waiting on a single-sided deposit, so there is
# no reason to keep its oracle warm at all — check TVL before paying for this.
#
# Cost and usability are coupled through maxDeviationBps, which the vault owner sets up to 5%.
# A wider band tolerates the longer TWAP window that a slower keeper produces: 5-minute pokes
# with a 3% band cost a third of 90-second pokes with the default 1%.
set -euo pipefail

RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
FACTORY="${SLICE_FACTORY:-0x219DF226816e4CCcAAF8C7fAB7469837e857c05b}"
INTERVAL="${KEEPER_INTERVAL:-90}"
# Two ways to sign, because the two places this runs want different things. An encrypted keystore
# is right on a laptop, where a person can type a password; a raw key is what CI has to use, since
# there is nobody there to prompt.
#
#   KEEPER_ACCOUNT=slice-keeper KEEPER_PASSWORD=...  ./script/keeper.sh   # keystore
#   PRIVATE_KEY=0x...                                ./script/keeper.sh   # raw key
if [ -n "${KEEPER_ACCOUNT:-}" ]; then
  # Ask once, here, rather than making the caller paste a secret into a command line. A password
  # on the command line lands in shell history and in the process list, and a command with a
  # placeholder in it invites pasting the placeholder — which decrypts nothing and shows up much
  # later as an unexplained "poke failed". CI has no terminal, so it sets KEEPER_PASSWORD instead.
  if [ -z "${KEEPER_PASSWORD:-}" ]; then
    if [ -t 0 ]; then
      printf "Keystore password for '%s': " "$KEEPER_ACCOUNT" >&2
      read -rs KEEPER_PASSWORD
      printf "
" >&2
    else
      echo "No terminal to prompt on, and KEEPER_PASSWORD is not set."
      echo "Set it in the environment (that is what CI does) or run this from a terminal."
      exit 1
    fi
  fi

  # --password, not an environment variable: cast does not read CAST_PASSWORD for a keystore.
  SIGNER=(--account "$KEEPER_ACCOUNT" --password "$KEEPER_PASSWORD")

  # Prove the password decrypts before entering the loop. Otherwise every send fails silently and
  # the only symptom is "poke failed" repeating every 90 seconds for an unrelated-looking reason.
  if ! cast wallet address "${SIGNER[@]}" >/dev/null 2>&1; then
    echo "That password does not decrypt the keystore '$KEEPER_ACCOUNT'."
    echo "It is the password you chose when running ./script/new-deployer-key.sh."
    exit 1
  fi
else
  : "${PRIVATE_KEY:?set PRIVATE_KEY, or KEEPER_ACCOUNT for a keystore}"
fi

# Below ~58s a full ring cannot span the 30-minute window, so the oracle would never warm.
# Refuse rather than run a keeper that burns gas forever and unlocks nothing.
if [ "$INTERVAL" -lt 60 ]; then
  echo "KEEPER_INTERVAL=$INTERVAL is too short. The oracle ring holds 32 observations, so an"
  echo "interval under ~58s spans less than the 30-minute TWAP window and never warms."
  echo "Use 90 (the default), or anything from 60 upward."
  exit 1
fi
if [ -z "${SIGNER:-}" ]; then
  case "$PRIVATE_KEY" in 0x*) ;; *) PRIVATE_KEY="0x$PRIVATE_KEY";; esac
  SIGNER=(--private-key "$PRIVATE_KEY")
fi

ONCE=false
[ "${1:-}" = "--once" ] && ONCE=true

# Captures output rather than discarding it, so a failure can be explained without being
# repeated. The previous version re-sent the transaction purely to obtain an error
# message, which spends gas a second time and re-runs a state change that may well have
# succeeded — a "failure" that printed a block hash was exactly that.
LAST_OUT=""
# --async: submit and move on, rather than waiting for a receipt.
#
# Arc's public RPC is load balanced, so the node that accepts a transaction and the node asked for
# its receipt are often a block apart, and the read fails with "request beyond head block" for a
# transaction that landed perfectly well. The keeper never inspects a receipt — it pokes on a timer
# — so waiting for one buys nothing and turns an ordinary RPC race into a reported failure.
#
# A submission error (bad nonce, empty wallet, wrong password) still fails here, which is what the
# reporting below is for.
send() { LAST_OUT=$(cast send --async "$@" --rpc-url "$RPC" "${SIGNER[@]}" 2>&1); }
call() { cast call "$@" --rpc-url "$RPC" 2>/dev/null | head -1 | sed 's/ \[.*//'; }

round() {
  local count vault warm pending supply skipped
  count=$(call "$FACTORY" "vaultCount()(uint256)")
  [ -n "$count" ] || { echo "$(date -u +%T) cannot reach the factory"; return; }
  skipped=0

  for ((i = 0; i < count; i++)); do
    vault=$(call "$FACTORY" "allVaults(uint256)(address)" "$i")
    [ -n "$vault" ] || continue

    # Skip vaults nobody has staked in.
    #
    # Creating a vault is permissionless, so anyone may add one at any time and whoever runs this
    # pays for it forever after. An empty vault has no fees to harvest and no depositor waiting on
    # a price, so a warm oracle buys nothing — and without this the running cost is set by how many
    # vaults strangers have created rather than by how much money the protocol actually holds.
    #
    # The moment somebody deposits, two-sided deposits work without any oracle at all, so the vault
    # is picked up on the next cycle and warms from there.
    supply=$(call "$vault" "totalSupply()(uint256)")
    if [ "${supply:-0}" = "0" ]; then
      skipped=$((skipped + 1))
      continue
    fi

    if ! send "$vault" "poke()"; then
      # The reason matters: a bad password, an empty wallet and an RPC timeout all look the same
      # otherwise and need completely different fixes. Taken from the call that actually failed.
      why=$(printf '%s' "$LAST_OUT" | grep -iE "error|warning|reverted|timeout|refused" | head -1)
      echo "$(date -u +%T) $vault poke failed: ${why:-see above}"
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

  # Say so rather than going quiet: a keeper printing nothing looks broken, and "every vault is
  # empty" is a fact worth seeing.
  if [ "$skipped" -gt 0 ]; then
    echo "$(date -u +%T) skipped $skipped empty vault(s) of $count — nothing staked, nothing to keep warm"
  fi
}

echo "keeper: factory $FACTORY on $RPC, every ${INTERVAL}s"
round
$ONCE && exit 0
while true; do
  sleep "$INTERVAL"
  round
done
