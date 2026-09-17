#!/usr/bin/env bash
# Move ownership, the treasury and the fee recipient to a new address.
#
#   PRIVATE_KEY=<the OLD key> ./script/rotate-owner.sh 0xNEW
#
# Run this when the current key has been exposed — pasted into a terminal, a chat, a screenshot.
# It does not need a redeploy: every vault has setOwner, setTreasury and setDepositFee, and the
# factory has setOwner and setTreasury for the vaults it creates next.
#
# ORDER MATTERS, AND IT IS NOT REVERSIBLE
#
# setOwner is the last call made against each contract, because the moment it lands the old key
# can no longer call anything else there. Doing it first would strand the treasury and the fee
# recipient pointing at an address whose key you are trying to retire, with no way back.
#
# The new address is checked before anything is sent:
#   - it must be a well-formed address, and not the one already in place
#   - it must not be blocklisted by Circle, or it could never collect a fee on Arc
#   - you must confirm you can actually sign with it
#
# That last one is the whole risk. Nothing here proves you hold the key; if you rotate to an
# address you cannot sign for, the vaults are ownerless for good. Their stakers stay safe —
# deposits, withdrawals and claims need no owner — but no parameter can ever be changed again.
#
# Safe to re-run: anything already pointing at the new address is skipped.
set -euo pipefail

RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
FACTORY="${SLICE_FACTORY:-0x9ABDd9Ba9C8Cb77e8676141c5bDa18fD107beD7D}"
BLOCKLIST=0x1800000000000000000000000000000000000001

NEW="${1:-}"
[ -n "$NEW" ] || { echo "usage: PRIVATE_KEY=<old key> $0 0xNEW_OWNER"; exit 1; }
[[ "$NEW" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "'$NEW' is not an address."; exit 1; }

command -v cast >/dev/null || { echo "cast not found. Add ~/.foundry/bin to PATH."; exit 1; }

if [ -n "${SLICE_ACCOUNT:-}" ]; then
  if [ -z "${SLICE_PASSWORD:-}" ]; then
    printf "Keystore password for '%s': " "$SLICE_ACCOUNT" >&2
    read -rs SLICE_PASSWORD
    echo >&2
  fi
  SIGNER=(--account "$SLICE_ACCOUNT" --password "$SLICE_PASSWORD")
else
  : "${PRIVATE_KEY:?set PRIVATE_KEY to the CURRENT owner key, or SLICE_ACCOUNT for a keystore}"
  case "$PRIVATE_KEY" in 0x*) ;; *) PRIVATE_KEY="0x$PRIVATE_KEY";; esac
  SIGNER=(--private-key "$PRIVATE_KEY")
fi

OLD=$(cast wallet address "${SIGNER[@]}")
echo "Current owner (signing): $OLD"
echo "New owner:               $NEW"
echo "Factory:                 $FACTORY"
echo

[ "${OLD,,}" != "${NEW,,}" ] || { echo "Those are the same address. Nothing to do."; exit 1; }

CHAIN=$(cast chain-id --rpc-url "$RPC")
[ "$CHAIN" = "5042" ] || { echo "Expected Arc mainnet (5042), got $CHAIN"; exit 1; }

# Arc's USDC consults Circle's compliance precompile on every transfer. A blocklisted treasury
# could never collect a protocol fee, and a blocklisted fee recipient would revert every deposit
# that charges one — which would take the product down, not just the fees.
if [ "$(cast call $BLOCKLIST 'isBlocklisted(address)(bool)' "$NEW" --rpc-url "$RPC")" = "true" ]; then
  echo "$NEW is blocklisted by Circle. It could never receive a fee on Arc. Aborting."
  exit 1
fi
echo "New owner is not blocklisted."

if [ "$(cast code "$NEW" --rpc-url "$RPC")" != "0x" ]; then
  echo
  echo "NOTE: $NEW is a contract, not a plain wallet. Make sure it can call setOwner,"
  echo "      setTreasury and setDepositFee, or those settings freeze where they are."
fi

cat <<EOF

This will point ownership, the treasury and the entry-fee recipient at $NEW,
on every vault and on the factory. After it lands, the key you are signing with now
controls nothing.

Confirm you can sign with $NEW. If you cannot, the vaults become permanently
unconfigurable — stakers keep full access to their money, but no parameter changes again.
EOF
read -rp "Type the new address to continue: " CONFIRM
[ "${CONFIRM,,}" = "${NEW,,}" ] || { echo "That did not match. Aborted."; exit 1; }

RPC_RACE="beyond head block|header not found|timeout|connection (closed|reset|refused)|502|503|504"
NEXT_NONCE=""
refresh_nonce() {
  NEXT_NONCE=$(cast nonce "$OLD" --block pending --rpc-url "$RPC" 2>/dev/null) \
    || NEXT_NONCE=$(cast nonce "$OLD" --rpc-url "$RPC" 2>/dev/null)
}

# Same shape as set-params.sh: a nonce complaint needs the counter re-read, a node lagging the
# head needs only a pause, anything else is real and retrying cannot help.
send() {
  local out status attempt=0
  [ -n "$NEXT_NONCE" ] || refresh_nonce
  while :; do
    if out=$(cast send --async --nonce "$NEXT_NONCE" "$@" --rpc-url "$RPC" "${SIGNER[@]}" 2>&1); then
      status=0; break
    fi
    status=1; attempt=$((attempt + 1))
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
  else
    NEXT_NONCE=""
    printf '%s' "$out" | head -2 >&2
  fi
  return $status
}

# Reads current value, sends only if it differs, and never guesses: a failed read aborts rather
# than sending a transaction based on nothing.
set_if_needed() {
  local what="$1" target="$2" getter="$3" setter="$4"; shift 4
  local now
  now=$(cast call "$target" "$getter" --rpc-url "$RPC" 2>/dev/null | head -1) || {
    echo "    could not read $getter — skipping, run again"; return 1; }
  if [ "${now,,}" = "${NEW,,}" ]; then
    echo "    $what already $NEW"
    return 0
  fi
  printf "    %s %s -> %s ... " "$what" "$now" "$NEW"
  if send "$target" "$setter" "$@"; then echo "sent"; else echo "FAILED"; return 1; fi
}

refresh_nonce
COUNT=$(cast call "$FACTORY" "vaultCount()(uint256)" --rpc-url "$RPC" | head -1)
echo
echo "$COUNT vaults"

FAILED=0
for i in $(seq 0 $((COUNT - 1))); do
  V=$(cast call "$FACTORY" "allVaults(uint256)(address)" --rpc-url "$RPC" "$i" | head -1)
  SYM=$(cast call "$V" "symbol()(string)" --rpc-url "$RPC" | head -1 | tr -d '"')
  echo "  $SYM  $V"

  # setDepositFee takes the rate and the recipient together, so the current rate is read and
  # passed back unchanged — omitting it would silently set the entry fee to zero.
  BPS=$(cast call "$V" "depositFeeBps()(uint16)" --rpc-url "$RPC" | head -1)
  set_if_needed "fee recipient" "$V" "feeRecipient()(address)" "setDepositFee(uint16,address)" "$BPS" "$NEW" || FAILED=$((FAILED+1))
  set_if_needed "treasury     " "$V" "treasury()(address)" "setTreasury(address)" "$NEW" || FAILED=$((FAILED+1))
  # Last. After this the signing key can no longer touch this vault.
  set_if_needed "owner        " "$V" "owner()(address)" "setOwner(address)" "$NEW" || FAILED=$((FAILED+1))
done

echo "  factory $FACTORY"
set_if_needed "treasury     " "$FACTORY" "treasury()(address)" "setTreasury(address)" "$NEW" || FAILED=$((FAILED+1))
set_if_needed "owner        " "$FACTORY" "owner()(address)" "setOwner(address)" "$NEW" || FAILED=$((FAILED+1))

echo
echo "Waiting for inclusion..."
sleep 15

echo "On chain now:"
BAD=0
for i in $(seq 0 $((COUNT - 1))); do
  V=$(cast call "$FACTORY" "allVaults(uint256)(address)" --rpc-url "$RPC" "$i" | head -1)
  SYM=$(cast call "$V" "symbol()(string)" --rpc-url "$RPC" | head -1 | tr -d '"')
  for pair in "owner()(address)" "treasury()(address)" "feeRecipient()(address)"; do
    NOW=$(cast call "$V" "$pair" --rpc-url "$RPC" | head -1)
    MARK=" "; [ "${NOW,,}" = "${NEW,,}" ] || { MARK="!"; BAD=$((BAD+1)); }
    printf "  %s %-12s %-22s %s\n" "$MARK" "$SYM" "${pair%%(*}" "$NOW"
  done
done
for pair in "owner()(address)" "treasury()(address)"; do
  NOW=$(cast call "$FACTORY" "$pair" --rpc-url "$RPC" | head -1)
  MARK=" "; [ "${NOW,,}" = "${NEW,,}" ] || { MARK="!"; BAD=$((BAD+1)); }
  printf "  %s %-12s %-22s %s\n" "$MARK" "factory" "${pair%%(*}" "$NOW"
done

echo
if [ "$BAD" -eq 0 ]; then
  echo "Rotation complete. The old key controls nothing."
  echo "Delete it from your shell history and treat it as burned."
else
  echo "$BAD setting(s) did not take. Run this again — what succeeded is skipped."
  echo "If a vault's owner already moved but its treasury did not, the OLD key can no longer"
  echo "fix it. Re-run signing with the NEW key instead."
fi
