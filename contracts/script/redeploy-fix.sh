#!/usr/bin/env bash
# Replace the live mainnet deployment with one that can accept a first deposit.
#
#   ./script/redeploy-fix.sh
#
# Why this exists
# ---------------
# The vaults deployed before this could not take a USDC-only deposit as their first one. That
# deposit swaps half the input, then immediately collects the LP fees the swap paid — and the
# collection asks Uniswap v4 to update a position the vault has not opened yet, which v4 refuses
# outright with `CannotUpdateEmptyPosition`. Every vault starts in that state, so every vault
# rejected the first person who tried to use it, whatever amount they entered. The fix is a guard
# in `_collectFees`, but a deployed vault is immutable, so it only reaches users at new addresses.
#
# Nothing is stranded by this. All three live vaults hold zero shares and zero liquidity — the bug
# meant nobody ever got in. The old addresses are simply abandoned.
#
# Key handling matches deploy-mainnet.sh: keystore if present, else PRIVATE_KEY, else a hidden
# prompt. The key is never written to disk.
set -euo pipefail

RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
OWNER="${DELTA_OWNER:-0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030}"
TREASURY="${DELTA_TREASURY:-0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030}"
KEYSTORE="$HOME/.foundry/keystores/slice-deployer"
OUT="redeploy-$(date +%Y%m%d-%H%M%S).log"

# The pools currently listed, read off the old vaults with `poolKey()` rather than retyped from
# memory: currency0 currency1 fee tickSpacing hooks label
POOLS=(
  "0x3600000000000000000000000000000000000000 0xBDBB76DB770cC99DCF3FA31C42C171b9584D6a10 10000 200 0x110C4Ae6dFd0376CAB3B5367256b4C56fE2De044 CINU"
  "0x3600000000000000000000000000000000000000 0xac61f15a9E41B62c484EFcC5DBd57044E1793A8f 10000 200 0x15d8EE821b82f2Cc067Ee2ab50a0eA826c812044 ARC-101"
  "0x3600000000000000000000000000000000000000 0xBb0b832E483E8B212F19dd6D741cFc3Cb5077431 10000 200 0xE70046aaE22965Ca2Fcd282af9FF04d56Db42044 ADAO"
)

command -v cast >/dev/null || { echo "cast not found. Add ~/.foundry/bin to PATH."; exit 1; }

# --- signer ------------------------------------------------------------------------
if [ -e "$KEYSTORE" ]; then
  # A password is typed, not pasted, which is the whole reason the keystore is worth having on a
  # machine where pasting into a hidden prompt is unreliable. Asked once and proven here: this
  # run sends seven transactions, and being asked seven times — or discovering on the fourth that
  # the password was wrong — would both be worse.
  if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
    printf "Keystore password for 'slice-deployer': "
    read -rs KEYSTORE_PASSWORD
    echo
  fi
  SIGNER=(--account slice-deployer --password "$KEYSTORE_PASSWORD")
  if ! ADDR=$(cast wallet address "${SIGNER[@]}" 2>/dev/null); then
    echo "That password does not decrypt the keystore 'slice-deployer'."
    exit 1
  fi
elif [ -n "${PRIVATE_KEY:-}" ]; then
  PK="$PRIVATE_KEY"
else
  echo "Paste the deployer private key, then press Enter."
  echo
  echo "Input is hidden, so the window will look like nothing happened — that is expected."
  echo "It confirms the length once you press Enter, without showing the key."
  echo
  echo "To paste in Git Bash:  Shift+Insert,  or right-click inside the window,"
  echo "                       or the icon top-left -> Edit -> Paste."
  echo "If none of those work: press Ctrl+C and run it with the key on the line instead:"
  echo "    PRIVATE_KEY=<key> ./script/redeploy-fix.sh"
  echo
  printf "key: "
  read -rs PK
  echo
  # Feedback without disclosure. Reading nothing at all looks identical to reading a key when
  # the echo is off, which is a miserable thing to guess at — and a key that arrived truncated
  # would otherwise only announce itself as a wrong deployer address further down.
  echo "(read ${#PK} characters)"
  [ -n "$PK" ] || {
    echo "Nothing was read — the paste did not reach the prompt. Try the PRIVATE_KEY= form above."
    exit 1
  }
fi
if [ -n "${PK:-}" ]; then
  # Strip anything a paste may have carried in: surrounding whitespace, a stray newline, the
  # quotes some terminals add. Then normalise the prefix, because cast wants it and pasted keys
  # usually lack it.
  PK=$(printf '%s' "$PK" | tr -d '[:space:]"'"'")
  case "$PK" in 0x*) ;; *) PK="0x$PK";; esac

  if [ ${#PK} -ne 66 ]; then
    echo "That is ${#PK} characters; a private key is 64 hex digits (66 with the 0x)."
    echo "It probably arrived truncated. Try again, or use the PRIVATE_KEY= form."
    exit 1
  fi

  SIGNER=(--private-key "$PK")
  ADDR=$(cast wallet address --private-key "$PK") \
    || { echo "That does not parse as a private key."; exit 1; }
fi
echo "Deployer: $ADDR"

CHAIN=$(cast chain-id --rpc-url "$RPC")
[ "$CHAIN" = "5042" ] || { echo "Expected Arc mainnet (5042), got $CHAIN"; exit 1; }

# Balances are 18-decimal and overflow every shell arithmetic context, so compare as bigints:
# digit count first, then lexicographically once the lengths match.
shopt -s extglob
ge_bigint() {
  local a="${1##+(0)}" b="${2##+(0)}"
  a="${a:-0}"; b="${b:-0}"
  if [ "${#a}" -ne "${#b}" ]; then [ "${#a}" -gt "${#b}" ]; return $?; fi
  [ "$a" \> "$b" ] || [ "$a" = "$b" ]
}
GAS=$(cast balance "$ADDR" --rpc-url "$RPC")
echo "Gas balance: $GAS (18dp native USDC)"
# A factory plus three vaults, at the gas prices observed on Arc so far.
if ! ge_bigint "$GAS" 12000000000000000000; then
  echo
  echo "Not enough USDC for gas. Send at least 12 USDC to $ADDR on Arc mainnet, then run again."
  echo "Current gas price: $(cast gas-price --rpc-url "$RPC") wei"
  exit 1
fi

# The whole point of this run is the fix, so check it is actually in the tree being compiled.
grep -q "totalLiquidity == 0) return (0, 0);" src/LiquidityVault.sol \
  || { echo "The _collectFees guard is missing from src/LiquidityVault.sol. Refusing to deploy."; exit 1; }
echo "Running the test suite first..."
forge test >/dev/null || { echo "Tests fail. Refusing to deploy."; exit 1; }
echo "Tests pass, fix present."

echo
read -rp "Deploy a new factory and three vaults to Arc MAINNET? Type 'deploy': " CONFIRM
[ "$CONFIRM" = "deploy" ] || { echo "Aborted."; exit 1; }

# --- factory -----------------------------------------------------------------------
echo "Deploying factory..." | tee "$OUT"
DELTA_OWNER="$OWNER" DELTA_TREASURY="$TREASURY" \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --skip-simulation "${SIGNER[@]}" \
  >> "$OUT" 2>&1

FACTORY=$(grep -oE "VaultFactory[^0-9a-fA-Fx]*0x[0-9a-fA-F]{40}" "$OUT" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
VDEPLOYER=$(grep -oE "VaultDeployer[^0-9a-fA-Fx]*0x[0-9a-fA-F]{40}" "$OUT" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
[ -n "$FACTORY" ] || { echo "Could not find the factory address in $OUT. Read it there and finish by hand."; exit 1; }
echo "VaultFactory:  $FACTORY"
echo "VaultDeployer: $VDEPLOYER"

# --- vaults ------------------------------------------------------------------------
# The vault address comes from the factory's own list rather than from parsing the receipt: the
# factory appends on create, so the last entry is the one just made.
for p in "${POOLS[@]}"; do
  set -- $p
  LABEL=$6
  echo
  echo "Creating vault for $LABEL..."
  if ! cast send "$FACTORY" "createVault((address,address,uint24,int24,address))" \
        "($1,$2,$3,$4,$5)" --rpc-url "$RPC" "${SIGNER[@]}" >> "$OUT" 2>&1; then
    echo "  createVault failed for $LABEL — see $OUT"
    continue
  fi

  N=$(cast call "$FACTORY" "vaultCount()(uint256)" --rpc-url "$RPC" | head -1)
  V=$(cast call "$FACTORY" "allVaults(uint256)(address)" --rpc-url "$RPC" $((N - 1)) | head -1)
  echo "  $LABEL vault: $V"

  # Start the oracle now. The ring needs thirty minutes of span before a USDC-only deposit is
  # allowed, and that clock only starts once something has poked it.
  cast send "$V" "poke()" --rpc-url "$RPC" "${SIGNER[@]}" >> "$OUT" 2>&1 || true
done

cat <<EOF

Done. Log: $OUT

  VaultFactory:  $FACTORY
  VaultDeployer: $VDEPLOYER

Next:
  1. Put those two addresses into app/src/lib/deployments.ts under chain 5042, and redeploy the app.
  2. Start the keeper so the new vaults' oracles keep warming:  ./script/keeper.sh
  3. Single-sided deposits become available about thirty minutes after the first poke.
     Two-sided deposits work immediately — they never consult a price.

The old factory and its three vaults are abandoned. They hold nothing, so nothing is stranded.
EOF
