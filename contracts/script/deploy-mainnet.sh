#!/usr/bin/env bash
# One-shot Arc mainnet deploy, with the checks that matter run before anything is broadcast.
#
#   ./script/deploy-mainnet.sh
#
# Key handling: uses the encrypted keystore 'slice-deployer' if it exists. Otherwise it prompts
# for a private key with the terminal echo off, so the key does not land in your shell history,
# in the process list, or in a transcript. It is never written to disk.
set -euo pipefail

RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
OWNER="${DELTA_OWNER:-0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030}"
TREASURY="${DELTA_TREASURY:-0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030}"
USDC=0x3600000000000000000000000000000000000000
BLOCKLIST=0x1800000000000000000000000000000000000001
KEYSTORE="$HOME/.foundry/keystores/slice-deployer"

command -v cast >/dev/null || { echo "cast not found. Add C:\Users\$USER\.foundry\bin to PATH."; exit 1; }

# --- pick the signer ---------------------------------------------------------------
if [ -e "$KEYSTORE" ]; then
  SIGNER=(--account slice-deployer)
  echo "Signer: keystore 'slice-deployer'"
  ADDR=$(cast wallet address --account slice-deployer)
elif [ -n "${PRIVATE_KEY:-}" ]; then
  # Supplied by the environment, e.g.  PRIVATE_KEY=0x... ./script/deploy-mainnet.sh
  PK="$PRIVATE_KEY"
  echo "Signer: PRIVATE_KEY from the environment"
else
  echo "No keystore at $KEYSTORE, and PRIVATE_KEY is not set."
  echo
  echo "Paste the deployer private key. Input is hidden and nothing is written to disk."
  echo "In Git Bash, Ctrl+V does NOT paste — use Shift+Insert, or right-click the window."
  echo "Or press Ctrl+C and run:  PRIVATE_KEY=<key> ./script/deploy-mainnet.sh"
  echo
  printf "key: "
  read -rs PK
  echo
  [ -n "$PK" ] || { echo "Empty key — nothing read. See the paste note above."; exit 1; }
fi

# Normalise before deriving anything: cast wants the 0x prefix, and a pasted key often lacks it.
if [ -n "${PK:-}" ]; then
  case "$PK" in 0x*) ;; *) PK="0x$PK";; esac
  SIGNER=(--private-key "$PK")
  ADDR=$(cast wallet address --private-key "$PK")     || { echo "That does not parse as a private key (expected 64 hex characters)."; exit 1; }
fi
echo "Deployer: $ADDR"

# --- preflight ---------------------------------------------------------------------
CHAIN=$(cast chain-id --rpc-url "$RPC")
[ "$CHAIN" = "5042" ] || { echo "Expected Arc mainnet (5042), got $CHAIN"; exit 1; }

# Balances are 18-decimal and overflow every shell arithmetic context, so compare as bigints:
# by digit count first, then lexicographically once the lengths match.
shopt -s extglob
ge_bigint() {
  local a="${1##+(0)}" b="${2##+(0)}"
  a="${a:-0}"; b="${b:-0}"
  if [ "${#a}" -ne "${#b}" ]; then [ "${#a}" -gt "${#b}" ]; return $?; fi
  [ "$a" \> "$b" ] || [ "$a" = "$b" ]
}

GAS=$(cast balance "$ADDR" --rpc-url "$RPC")
echo "Gas balance (18dp native USDC): $GAS"
# 10.13M gas at 45 gwei is ~0.46 USDC; insist on 5 USDC so a vault and a seed also fit.
if ! ge_bigint "$GAS" 5000000000000000000; then
  echo
  echo "Not enough USDC for gas. Arc charges gas in USDC."
  echo "Send at least 5 USDC to $ADDR on Arc mainnet, then run this again."
  exit 1
fi

for who in "owner $OWNER" "treasury $TREASURY"; do
  set -- $who
  if [ "$(cast call $BLOCKLIST 'isBlocklisted(address)(bool)' "$2" --rpc-url "$RPC")" = "true" ]; then
    echo "$1 $2 is blocklisted by Circle — fee collection would revert. Aborting."
    exit 1
  fi
done
echo "Owner:    $OWNER (not blocklisted)"
echo "Treasury: $TREASURY (not blocklisted)"

# --- dry run -----------------------------------------------------------------------
echo
echo "--- dry run (nothing is sent) ---"
DELTA_OWNER="$OWNER" DELTA_TREASURY="$TREASURY" \
  forge script script/Deploy.s.sol --rpc-url "$RPC" 2>&1 \
  | grep -E "Script ran|chain id|pool manager|usdc|owner|treasury|Estimated amount|Error|revert"

echo
read -rp "Broadcast this to Arc MAINNET? Type 'deploy' to continue: " CONFIRM
[ "$CONFIRM" = "deploy" ] || { echo "Aborted."; exit 1; }

# --- broadcast ---------------------------------------------------------------------
DELTA_OWNER="$OWNER" DELTA_TREASURY="$TREASURY" \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --skip-simulation "${SIGNER[@]}"

cat <<EOF

Deployed. Record the VaultFactory and VaultDeployer addresses printed above.

Next: create a vault for a pool, then verify before telling anyone about it —
see MAINNET.md, "Create a vault" and "Verify before announcing".
EOF
