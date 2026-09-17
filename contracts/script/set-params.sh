#!/usr/bin/env bash
# Apply governance parameters to every vault the factory knows about.
#
#   PRIVATE_KEY=<key> ./script/set-params.sh [maxDeviationBps]
#
# Defaults to 500, the contract's ceiling. Safe to re-run: a vault already at the target is
# skipped rather than paid for again, so a partial run just needs running again.
#
# Why not a for-loop with cast send
# --------------------------------
# Because that is what produced "nonce too low: next nonce 19, tx nonce 18" on the second of three
# sends. --async returns before the transaction is mined, so cast never learns the nonce moved and
# hands the same one to the next send. Dropping --async is not the fix either: Arc's endpoint is
# load-balanced across nodes that disagree about the head, so waiting for a receipt reports
# perfectly good transactions as failures. The nonce is tracked here instead, the same way the
# keeper does it.
set -euo pipefail

RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
FACTORY="${SLICE_FACTORY:-0x9ABDd9Ba9C8Cb77e8676141c5bDa18fD107beD7D}"
BAND="${1:-500}"

# Left at their deployed values; this script exists for the band. Passing them explicitly is
# unavoidable — setParameters takes all three at once, so omitting them would zero them.
PROTOCOL_FEE_BPS="${SLICE_PROTOCOL_FEE_BPS:-1000}"
STREAM_BPS="${SLICE_STREAM_BPS:-10000}"

command -v cast >/dev/null || { echo "cast not found. Add ~/.foundry/bin to PATH."; exit 1; }

if [ -n "${SLICE_ACCOUNT:-}" ]; then
  if [ -z "${SLICE_PASSWORD:-}" ]; then
    printf "Keystore password for '%s': " "$SLICE_ACCOUNT" >&2
    read -rs SLICE_PASSWORD
    echo >&2
  fi
  SIGNER=(--account "$SLICE_ACCOUNT" --password "$SLICE_PASSWORD")
else
  : "${PRIVATE_KEY:?set PRIVATE_KEY, or SLICE_ACCOUNT for a keystore}"
  case "$PRIVATE_KEY" in 0x*) ;; *) PRIVATE_KEY="0x$PRIVATE_KEY";; esac
  SIGNER=(--private-key "$PRIVATE_KEY")
fi

ADDR=$(cast wallet address "${SIGNER[@]}")
echo "Signer:  $ADDR"
echo "Factory: $FACTORY"
echo "Target:  maxDeviationBps=$BAND (protocolFee=$PROTOCOL_FEE_BPS, stream=$STREAM_BPS)"
echo

[ "$BAND" -ge 1 ] && [ "$BAND" -le 500 ] || {
  echo "maxDeviationBps must be between 1 and 500 — the contract rejects anything else."
  exit 1
}

RPC_RACE="beyond head block|header not found|timeout|connection (closed|reset|refused)|502|503|504"
NEXT_NONCE=""

refresh_nonce() {
  NEXT_NONCE=$(cast nonce "$ADDR" --block pending --rpc-url "$RPC" 2>/dev/null) \
    || NEXT_NONCE=$(cast nonce "$ADDR" --rpc-url "$RPC" 2>/dev/null)
}

# Same shape as the keeper's: a nonce complaint needs the counter re-read, a node lagging the head
# needs only a pause, and anything else is a real failure that retrying cannot help.
send() {
  local out status attempt=0
  [ -n "$NEXT_NONCE" ] || refresh_nonce

  while :; do
    if out=$(cast send --async --nonce "$NEXT_NONCE" "$@" --rpc-url "$RPC" "${SIGNER[@]}" 2>&1); then
      status=0
      break
    fi
    status=1
    attempt=$((attempt + 1))
    [ "$attempt" -ge 4 ] && break

    if printf '%s' "$out" | grep -qiE "nonce too low|already known|replacement transaction"; then
      refresh_nonce
    elif printf '%s' "$out" | grep -qiE "$RPC_RACE"; then
      sleep 2
    else
      break
    fi
  done

  if [ $status -eq 0 ]; then
    NEXT_NONCE=$((NEXT_NONCE + 1))
    printf '%s' "$out" | grep -oE '0x[0-9a-f]{64}' | head -1
  else
    NEXT_NONCE=""
    printf '%s' "$out" | head -2 >&2
  fi
  return $status
}

refresh_nonce
COUNT=$(cast call "$FACTORY" "vaultCount()(uint256)" --rpc-url "$RPC" | head -1)
echo "$COUNT vaults"

CHANGED=0
SKIPPED=0
FAILED=0
for i in $(seq 0 $((COUNT - 1))); do
  V=$(cast call "$FACTORY" "allVaults(uint256)(address)" --rpc-url "$RPC" "$i" | head -1)
  SYM=$(cast call "$V" "symbol()(string)" --rpc-url "$RPC" | head -1 | tr -d '"')
  NOW=$(cast call "$V" "maxDeviationBps()(uint16)" --rpc-url "$RPC" | head -1)

  if [ "$NOW" = "$BAND" ]; then
    printf "  %-14s %s  already %s bps, skipped\n" "$SYM" "$V" "$BAND"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  printf "  %-14s %s  %s -> %s bps ... " "$SYM" "$V" "$NOW" "$BAND"
  if TX=$(send "$V" "setParameters(uint16,uint16,uint16)" "$PROTOCOL_FEE_BPS" "$STREAM_BPS" "$BAND"); then
    echo "sent ${TX:-ok}"
    CHANGED=$((CHANGED + 1))
  else
    echo "FAILED"
    FAILED=$((FAILED + 1))
  fi
done

echo
echo "$CHANGED changed, $SKIPPED already set, $FAILED failed."
[ "$FAILED" -eq 0 ] || echo "Run it again — the ones that succeeded will be skipped."

# --async means the sends are submitted, not mined. Give them a few blocks, then read back what
# actually stuck: reporting "sent" for a transaction that never landed is the failure mode this
# whole script exists to avoid.
if [ "$CHANGED" -gt 0 ]; then
  echo
  echo "Waiting for inclusion..."
  sleep 12
  echo "On chain now:"
  for i in $(seq 0 $((COUNT - 1))); do
    V=$(cast call "$FACTORY" "allVaults(uint256)(address)" --rpc-url "$RPC" "$i" | head -1)
    SYM=$(cast call "$V" "symbol()(string)" --rpc-url "$RPC" | head -1 | tr -d '"')
    NOW=$(cast call "$V" "maxDeviationBps()(uint16)" --rpc-url "$RPC" | head -1)
    MARK=" "; [ "$NOW" = "$BAND" ] || MARK="!"
    printf "  %s %-14s band=%s\n" "$MARK" "$SYM" "$NOW"
  done
fi
