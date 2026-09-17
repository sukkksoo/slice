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
#   60s       32-minute window, and the tightest tracking of spot available.
#   90s       48-minute window.  <-- the default
#   300s      155-minute window. Warm, but the vault compares spot against a 2.5-hour average,
#             and with maxDeviationBps at 1% a volatile token sits outside the band most of
#             the time, so swaps and harvests keep deferring.
#
# The interval does NOT change how soon a new vault becomes usable. tryConsult answers as soon as
# any two retained observations span MIN_TWAP_WINDOW, so a freshly listed pool is warm 30 minutes
# after its first poke at any cadence. What the interval sets is where the window settles once the
# ring wraps, and therefore how closely the average follows spot — which is what decides whether a
# volatile token sits inside the deviation band. WarmupTiming.t.sol measures both.
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
# Redeployed 2026-09-17; the previous factory's vaults could not take a first deposit. Pointing
# the keeper at the old one would warm three oracles nobody can ever use.
FACTORY="${SLICE_FACTORY:-0x979889501A01aFc3264A87fC7e6cA54e659051D1}"
INTERVAL="${KEEPER_INTERVAL:-90}"
# How many depositless vaults to keep warm anyway, so a newly listed pool is usable at once.
MAX_EMPTY="${KEEPER_MAX_EMPTY:-3}"
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
#
# NONCE
#
# --async also means cast no longer learns the nonce from the previous send. With three vaults and
# two calls each, six transactions go out within seconds and the node hands several of them the
# same nonce: the log fills with "nonce too low" and "replacement transaction underpriced", and
# roughly half the pokes never happen. So it is tracked here — read from the pending pool once per
# round, incremented locally per send, and re-read if the node complains.
NEXT_NONCE=""

refresh_nonce() {
  NEXT_NONCE=$(cast nonce "$ADDR" --block pending --rpc-url "$RPC" 2>/dev/null)
  [ -n "$NEXT_NONCE" ] || NEXT_NONCE=$(cast nonce "$ADDR" --rpc-url "$RPC" 2>/dev/null)
}

send() {
  local status
  [ -n "$NEXT_NONCE" ] || refresh_nonce

  LAST_OUT=$(cast send --async --nonce "$NEXT_NONCE" "$@" --rpc-url "$RPC" "${SIGNER[@]}" 2>&1)
  status=$?

  if [ $status -ne 0 ] && printf '%s' "$LAST_OUT" | grep -qiE "nonce too low|already known|replacement transaction"; then
    refresh_nonce
    LAST_OUT=$(cast send --async --nonce "$NEXT_NONCE" "$@" --rpc-url "$RPC" "${SIGNER[@]}" 2>&1)
    status=$?
  fi

  if [ $status -eq 0 ]; then
    NEXT_NONCE=$((NEXT_NONCE + 1))
  else
    # Whatever went wrong, the local counter can no longer be trusted.
    NEXT_NONCE=""
  fi
  return $status
}
call() { cast call "$@" --rpc-url "$RPC" 2>/dev/null | head -1 | sed 's/ \[.*//'; }

# Poke a vault, then harvest it if its oracle can price the swap.
service() {
  local vault="$1" label="$2" warm pending

  if ! send "$vault" "poke()"; then
    # The reason matters: a bad password, an empty wallet and an RPC timeout all look the same
    # otherwise and need completely different fixes. Taken from the call that actually failed.
    local why
    why=$(printf '%s' "$LAST_OUT" | grep -iE "error|warning|reverted|timeout|refused" | head -1)
    echo "$(date -u +%T) $vault poke failed: ${why:-see above}"
    return
  fi

  warm=$(call "$vault" "prices()(bool,uint160,uint160)" | head -1)
  pending=$(call "$vault" "pendingAssetFees()(uint256)")

  # Harvest only once the oracle can price the swap. Calling it cold still works — it simply
  # defers the token side — but it burns gas to move fees from one pending bucket to another.
  if [ "$warm" = "true" ]; then
    send "$vault" "harvest()" || true
    echo "$(date -u +%T) $vault poked, warm, harvested$label"
  else
    echo "$(date -u +%T) $vault poked, still warming (deferred fees: ${pending:-0})$label"
  fi
}

round() {
  local count i vault supply
  refresh_nonce
  count=$(call "$FACTORY" "vaultCount()(uint256)")
  [ -n "$count" ] || { echo "$(date -u +%T) cannot reach the factory"; return; }

  # Sort the vaults into those holding deposits and those not, before poking anything.
  #
  # Creating a vault is permissionless, so anyone may add one and whoever runs this pays for it
  # from then on. Serving every empty vault lets a stranger set the bill; serving none deadlocks a
  # newly listed pool, since a single-sided deposit needs a warm oracle and the oracle will not
  # warm until somebody deposits.
  #
  # So: every funded vault is always served, and a few empty ones are too — but the empty ones are
  # taken NEWEST FIRST. Walking in creation order served the oldest empty vaults instead, which
  # meant that once a few abandoned pools existed, a pool listed a minute ago would be skipped and
  # never warm at all. The newest empty vault is precisely the one somebody is waiting on.
  local funded=() empty=()
  for ((i = 0; i < count; i++)); do
    vault=$(call "$FACTORY" "allVaults(uint256)(address)" "$i")
    [ -n "$vault" ] || continue
    supply=$(call "$vault" "totalSupply()(uint256)")
    if [ "${supply:-0}" = "0" ]; then empty+=("$vault"); else funded+=("$vault"); fi
  done

  for vault in "${funded[@]:-}"; do
    [ -n "$vault" ] && service "$vault" ""
  done

  local served=0 j
  for ((j = ${#empty[@]} - 1; j >= 0 && served < MAX_EMPTY; j--)); do
    service "${empty[j]}" "  [no deposits yet]"
    served=$((served + 1))
  done

  local skipped=$(( ${#empty[@]} - served ))
  if [ "$skipped" -gt 0 ]; then
    echo "$(date -u +%T) skipped $skipped empty vault(s) — nothing staked, nothing to keep warm"
  fi
}

# The signer's address, needed to read its nonce. Derived once from whichever signer is in use.
ADDR=$(cast wallet address "${SIGNER[@]}" 2>/dev/null)
if [ -z "$ADDR" ]; then
  echo "Could not derive the keeper address from the configured signer."
  exit 1
fi

echo "keeper: factory $FACTORY on $RPC, every ${INTERVAL}s"
echo "signer: $ADDR"
round
$ONCE && exit 0
while true; do
  sleep "$INTERVAL"
  round
done
