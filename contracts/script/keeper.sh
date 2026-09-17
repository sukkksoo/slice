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
#   15s, 30s  On a vault deployed before PoolOracle gained MIN_SPACING, the ring spans under 30
#             minutes and tryConsult never returns a price: the oracle stays cold forever,
#             however long the keeper runs, and poking harder makes it worse. Newer vaults
#             retain at most one observation a minute, so extra pokes cost gas and nothing else.
#   60s       31-minute window, and the tightest tracking of spot available.
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
# A keystore sitting at the default name is almost certainly the one meant. Requiring it to be
# named turns a machine that is already set up into "set PRIVATE_KEY, or KEEPER_ACCOUNT for a
# keystore" — which reads as "paste your raw key", the opposite of what this script wants.
if [ -z "${KEEPER_ACCOUNT:-}" ] && [ -z "${PRIVATE_KEY:-}" ] && [ -e "$HOME/.foundry/keystores/slice-keeper" ]; then
  KEEPER_ACCOUNT=slice-keeper
fi

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

# Below ~58s a full ring cannot span the 30-minute window on a vault deployed before PoolOracle
# gained MIN_SPACING, so the oracle would never warm. Refuse rather than run a keeper that burns
# gas forever and unlocks nothing. Kept even though newer vaults are immune, because the keeper
# serves whatever the factory lists and has no way to know which is which.
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

# Arc's public endpoint is load-balanced across nodes that do not always agree on the head block.
# A request routed to one that is a block behind comes back as
#
#   error code -32602: request beyond head block: requested 21333789, head 21333788
#
# which says nothing about this keeper, this vault or this key — the same call succeeds a second
# later against a node that has caught up. It is the same disagreement that made a createVault
# look like it had failed when it had not. Untreated it drops roughly one poke in three, and since
# the oracle needs 32 observations before it will price a swap, every dropped poke pushes the
# whole warm-up further out.
RPC_RACE="beyond head block|header not found|missing trie node|timeout|connection (closed|reset|refused)|502|503|504"
RETRIES=3

send() {
  local status attempt=0
  [ -n "$NEXT_NONCE" ] || refresh_nonce

  while :; do
    LAST_OUT=$(cast send --async --nonce "$NEXT_NONCE" "$@" --rpc-url "$RPC" "${SIGNER[@]}" 2>&1)
    status=$?
    [ $status -eq 0 ] && break

    attempt=$((attempt + 1))
    [ "$attempt" -ge "$RETRIES" ] && break

    if printf '%s' "$LAST_OUT" | grep -qiE "nonce too low|already known|replacement transaction"; then
      # Something else spent from this key, or a send landed that we were told had failed. The
      # local counter is wrong either way; re-read it and try the same call again.
      refresh_nonce
    elif printf '%s' "$LAST_OUT" | grep -qiE "$RPC_RACE"; then
      # Nothing was submitted, so the nonce still stands. Wait for the laggard to catch up.
      sleep 2
    else
      # A revert, an empty wallet, a wrong password: retrying burns gas and time and changes
      # nothing. Let it surface.
      break
    fi
  done

  if [ $status -eq 0 ]; then
    NEXT_NONCE=$((NEXT_NONCE + 1))
  else
    # Whatever went wrong, the local counter can no longer be trusted.
    NEXT_NONCE=""
  fi
  return $status
}

# Reads race the same way, and a read that loses silently is worse than one that fails loudly: an
# empty `prices()` reads as "not warm", so the log would report a warm vault as still warming and
# the harvest it was due would be skipped.
call() {
  local out attempt=0
  while :; do
    # `if out=$(...)` rather than a bare assignment: the status has to be *tested* for `set -e`
    # to leave it alone, and a plain assignment from a failing command is not a tested context.
    if out=$(cast call "$@" --rpc-url "$RPC" 2>&1); then
      printf '%s' "$out" | head -1 | sed 's/ \[.*//'
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$RETRIES" ] || ! printf '%s' "$out" | grep -qiE "$RPC_RACE"; then
      # Print nothing and still succeed, which is what the original pipeline did by ending in
      # `sed`. Callers read this as `warm=$(call ...)` — a plain assignment — so a non-zero
      # status here would trip `set -e` and take the keeper down over a single bad read.
      return 0
    fi
    sleep 1
  done
}

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

# ONE KEEPER, NOT TWO
#
# Two keepers do not make the oracle warm faster — they stop it warming at all, and they do it
# silently. Poking is what fills a ring of 32 observations, and `tryConsult` needs the ring to
# span 30 minutes before it will price a swap. Two instances at 90 seconds each poke every 45,
# so the same 32 slots cover 24 minutes instead of 48, and the vault reports its oracle as cold
# forever while both keepers log healthy rounds and spend gas.
#
# That happened: a keeper left running in one window, a second started in another, and every
# vault went from warm back to cold with nothing in either log to suggest why.
#
# So a second instance refuses to start. A stale lock from a keeper that was killed rather than
# stopped is cleared automatically — the pid in it no longer exists.
LOCK="${KEEPER_LOCK:-${TMPDIR:-/tmp}/slice-keeper-$(printf '%s' "$FACTORY" | tr 'A-Z' 'a-z').lock}"
if [ -e "$LOCK" ]; then
  OTHER=$(cat "$LOCK" 2>/dev/null || true)
  if [ -n "$OTHER" ] && kill -0 "$OTHER" 2>/dev/null; then
    echo "A keeper is already running for this factory (pid $OTHER)."
    echo
    echo "Running two halves the oracle's averaging window, which puts it under the 30 minutes"
    echo "the vault needs and stops single-sided deposits working at all. Stop that one first,"
    echo "or set KEEPER_LOCK to run a second deliberately against a different factory."
    exit 1
  fi
  echo "Clearing a stale lock from pid ${OTHER:-unknown}."
fi
printf '%s' "$$" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

echo "keeper: factory $FACTORY on $RPC, every ${INTERVAL}s"
echo "signer: $ADDR"

# How long the ring will span once it fills, given the cadence actually achieved rather than the
# one configured — a round takes time on top of the sleep, and anything else poking the same
# vaults shortens the spacing further. Printed rather than assumed, because a ring that falls
# short of 30 minutes produces no error anywhere: the oracle simply never warms.
SPAN_MIN=$(( 31 * INTERVAL / 60 ))
echo "ring: 32 observations, spanning about ${SPAN_MIN} min at this interval (needs > 30)"
if [ "$SPAN_MIN" -lt 34 ]; then
  echo "note: that is close to the 30-minute minimum. If anything else pokes these vaults the"
  echo "      ring will fall short of it and the oracle will never warm. 90s leaves more room."
fi

round
$ONCE && exit 0
while true; do
  sleep "$INTERVAL"
  round
done
