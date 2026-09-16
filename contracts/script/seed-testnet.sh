#!/usr/bin/env bash
# End-to-end smoke test against a live Arc deployment.
#
# WHY THIS IS A SHELL SCRIPT AND NOT A FORGE SCRIPT
#
# `forge script` executes the script locally to collect the transactions it will broadcast. Arc's
# USDC is a thin wrapper over two chain precompiles — a compliance check at 0x1800…0001 and a
# native balance move at 0x1800…0000 — and neither exists in Foundry's EVM. So any forge script
# that moves USDC dies with a stack underflow during the local pass and never broadcasts anything.
#
# `cast send` estimates gas against the real node instead, where the precompiles do exist. Hence
# this. The same limitation applies to anything else that simulates locally before broadcasting.
#
#   DELTA_FACTORY=0x… ./script/seed-testnet.sh
set -euo pipefail

: "${ARC_TESTNET_RPC_URL:?set ARC_TESTNET_RPC_URL}"
: "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${DELTA_FACTORY:?set DELTA_FACTORY to the deployed VaultFactory}"

T="$ARC_TESTNET_RPC_URL"
PK="$PRIVATE_KEY"
ME=$(cast wallet address --private-key "$PK")

USDC=0x3600000000000000000000000000000000000000
PM=0x8366a39CC670B4001A1121B8F6A443A643e40951
MAX=115792089237316195423570985008687907853269984665640564039457584007913129639935
MIN_SQRT=4295128740
MAX_SQRT=1461446703485210103287273052203988822378723970341

echo "deployer: $ME"
echo "usdc:     $(cast call $USDC 'balanceOf(address)(uint256)' "$ME" --rpc-url "$T")"

echo "--- deploying test token + swap router ---"
DTT=$(forge create script/mocks/TestToken.sol:TestToken --rpc-url "$T" --private-key "$PK" \
  --broadcast --constructor-args "Sluice Test Token" "DTT" | grep "Deployed to:" | awk '{print $3}')
SWAP=$(forge create lib/v4-periphery/lib/v4-core/src/test/PoolSwapTest.sol:PoolSwapTest \
  --rpc-url "$T" --private-key "$PK" --broadcast --constructor-args $PM \
  | grep "Deployed to:" | awk '{print $3}')
echo "TestToken:    $DTT"
echo "PoolSwapTest: $SWAP"

# Arc's USDC address is low, so a normally-deployed token almost always sorts above it. Check
# rather than assume: the pool key must be sorted or initialize reverts.
if [[ "${USDC,,}" < "${DTT,,}" ]]; then
  KEY="($USDC,$DTT,3000,60,0x0000000000000000000000000000000000000000)"
  SQRT=79228162514264337593543950336000000   # 1 token == 1 USDC, USDC as currency0
  USDC_FIRST=true
else
  KEY="($DTT,$USDC,3000,60,0x0000000000000000000000000000000000000000)"
  SQRT=79228162514264337593543  # 1 token == 1 USDC, token as currency0
  USDC_FIRST=false
fi
echo "usdc is currency0: $USDC_FIRST"

send() { cast send "$@" --rpc-url "$T" --private-key "$PK" > /dev/null; }

echo "--- pool + vault ---"
send "$DTT" "mint(address,uint256)" "$ME" 1000000000000000000000
send $PM "initialize((address,address,uint24,int24,address),uint160)" "$KEY" "$SQRT"
send "$DELTA_FACTORY" "createVault((address,address,uint24,int24,address))" "$KEY"
COUNT=$(cast call "$DELTA_FACTORY" "vaultCount()(uint256)" --rpc-url "$T")
VAULT=$(cast call "$DELTA_FACTORY" "allVaults(uint256)(address)" $((COUNT - 1)) --rpc-url "$T")
echo "Vault: $VAULT"

echo "--- stake 2 USDC + 2 DTT ---"
send $USDC "approve(address,uint256)" "$VAULT" $MAX
send "$DTT" "approve(address,uint256)" "$VAULT" $MAX
if [ "$USDC_FIRST" = true ]; then
  send "$VAULT" "deposit(uint256,uint256,uint256,address)" 2000000 2000000000000000000 0 "$ME"
else
  send "$VAULT" "deposit(uint256,uint256,uint256,address)" 2000000000000000000 2000000 0 "$ME"
fi
echo "shares: $(cast call "$VAULT" 'balanceOf(address)(uint256)' "$ME" --rpc-url "$T")"

echo "--- generate real swap fees, both directions ---"
SIG="swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)"
send $USDC "approve(address,uint256)" "$SWAP" $MAX
send "$DTT" "approve(address,uint256)" "$SWAP" $MAX
send "$SWAP" "$SIG" "$KEY" "($USDC_FIRST,-200000,$MIN_SQRT)" "(false,false)" 0x
OTHER=$([ "$USDC_FIRST" = true ] && echo false || echo true)
send "$SWAP" "$SIG" "$KEY" "($OTHER,-200000000000000000,$MAX_SQRT)" "(false,false)" 0x

echo "--- harvest (oracle is cold on a fresh vault: must defer, not revert) ---"
send "$VAULT" "harvest()"

cat <<EOF

DELTA_TOKEN=$DTT
DELTA_VAULT=$VAULT
DELTA_SWAP_ROUTER=$SWAP

pendingAssetFees:    $(cast call "$VAULT" 'pendingAssetFees()(uint256)' --rpc-url "$T")
pendingProtocolFees: $(cast call "$VAULT" 'pendingProtocolFees()(uint256)' --rpc-url "$T")
rewardRate:          $(cast call "$VAULT" 'rewardRate()(uint256)' --rpc-url "$T")

The token-side fees are deferred until the oracle spans its 30-minute TWAP window. Run
HarvestTestnet every few minutes; once prices() reports warm, the next harvest converts them
and the reward rate rises.
EOF
