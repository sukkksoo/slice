#!/usr/bin/env bash
# Full Arc mainnet bring-up in one run: factory, a vault on a live Argus pool, and verification.
#
#   PRIVATE_KEY=<key> ./script/go-live.sh
#
# No prompts. Everything it does is appended to deployments/mainnet.txt so the result can be read
# back afterwards, including by someone who was not watching the run.
set -euo pipefail

RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
OWNER=0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030
TREASURY=0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030
USDC=0x3600000000000000000000000000000000000000

# CINU — an Argus launch, the busier of the two pools checked. USDC sorts below any normally
# deployed token, so USDC is currency0. The hook is per-pool: Argus deploys one for each launch,
# so this is not a constant and must not be reused for another token.
TOKEN=0xBDBB76DB770cC99DCF3FA31C42C171b9584D6a10
HOOK=0x110C4Ae6dFd0376CAB3B5367256b4C56fE2De044
FEE=10000
SPACING=200

OUT=deployments/mainnet.txt
mkdir -p deployments

: "${PRIVATE_KEY:?set PRIVATE_KEY}"
case "$PRIVATE_KEY" in 0x*) ;; *) PRIVATE_KEY="0x$PRIVATE_KEY";; esac
ME=$(cast wallet address --private-key "$PRIVATE_KEY")

log() { echo "$*" | tee -a "$OUT"; }

[ "$(cast chain-id --rpc-url "$RPC")" = "5042" ] || { echo "not Arc mainnet"; exit 1; }

log "=== Slice mainnet bring-up  $(date -u +%FT%TZ) ==="
log "deployer   $ME"
log "gas        $(cast balance "$ME" --rpc-url "$RPC") wei"
log "gas price  $(cast gas-price --rpc-url "$RPC") wei"

# --- 1. factory ---------------------------------------------------------------------
log ""
log "--- deploying factory ---"
DELTA_OWNER=$OWNER DELTA_TREASURY=$TREASURY \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key "$PRIVATE_KEY" \
  --broadcast --skip-simulation 2>&1 | tee -a "$OUT" | grep -E "VaultFactory|VaultDeployer|EXECUTION" || true

FACTORY=$(grep -oE "VaultFactory +0x[0-9a-fA-F]{40}" "$OUT" | tail -1 | grep -oE "0x[0-9a-fA-F]{40}")
DEPLOYER=$(grep -oE "VaultDeployer +0x[0-9a-fA-F]{40}" "$OUT" | tail -1 | grep -oE "0x[0-9a-fA-F]{40}")
[ -n "$FACTORY" ] || { log "could not read the factory address back — see $OUT"; exit 1; }
log "FACTORY  $FACTORY"
log "DEPLOYER $DEPLOYER"

# --- 2. vault on the Argus pool -----------------------------------------------------
log ""
log "--- creating vault for CINU/USDC (Argus, 1% fee, spacing 200) ---"
KEY="($USDC,$TOKEN,$FEE,$SPACING,$HOOK)"
cast send "$FACTORY" "createVault((address,address,uint24,int24,address))" "$KEY" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >> "$OUT" 2>&1

COUNT=$(cast call "$FACTORY" "vaultCount()(uint256)" --rpc-url "$RPC" | head -1 | sed 's/ .*//')
VAULT=$(cast call "$FACTORY" "allVaults(uint256)(address)" $((COUNT - 1)) --rpc-url "$RPC" | head -1 | sed 's/ .*//')
log "VAULT    $VAULT"

# --- 3. start the oracle warming ----------------------------------------------------
log ""
log "--- first oracle observation (30 minutes of these before automated swaps unlock) ---"
cast send "$VAULT" "poke()" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >> "$OUT" 2>&1
log "poked"

# --- 4. verify ----------------------------------------------------------------------
log ""
log "--- verification ---"
v() { printf "  %-22s %s\n" "$1" "$(cast call "$VAULT" "$2" --rpc-url "$RPC" 2>&1 | head -1)" | tee -a "$OUT"; }
v symbol           "symbol()(string)"
v owner            "owner()(address)"
v treasury         "treasury()(address)"
v feeRecipient     "feeRecipient()(address)"
v depositFeeBps    "depositFeeBps()(uint16)"
v protocolFeeBps   "protocolFeeBps()(uint16)"
v assetCurrency    "assetCurrency()(address)"
v usdcIsCurrency0  "usdcIsCurrency0()(bool)"

log ""
log "gas left   $(cast balance "$ME" --rpc-url "$RPC") wei"
log ""
log "FACTORY=$FACTORY"
log "VAULT=$VAULT"
log ""
log "Done. Send the two lines above back to continue."
