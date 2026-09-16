#!/usr/bin/env bash
# Measure what a Uniswap v4 hook charges on a swap, against a live Arc node.
#
# WHY THIS IS NOT A FORGE TEST
#
# Launchpad hooks on Arc typically move USDC inside afterSwap — the Argus one transfers its cut to
# a treasury. That goes through Arc's balance-move precompile, which has no implementation in
# Foundry's EVM, so the swap reverts in a fork even though it works on-chain. `eth_call` against a
# real node runs the precompile, so the measurement has to happen there.
#
# The pool is live, so everything is pinned to one block. Reading slot0 at one moment and quoting
# at another produces nonsense — the first attempt at this showed an asymmetric, partly negative
# "tax" that turned out to be the price moving between calls.
#
#   ./script/measure-hook-tax.sh <token> <hook> [fee] [tickSpacing]
#
# Example — CINU, an Argus launch:
#   ./script/measure-hook-tax.sh \
#     0xbdbb76db770cc99dcf3fa31c42c171b9584d6a10 \
#     0x110C4Ae6dFd0376CAB3B5367256b4C56fE2De044
set -euo pipefail

TOKEN="${1:?usage: measure-hook-tax.sh <token> <hook> [fee] [tickSpacing]}"
HOOK="${2:?usage: measure-hook-tax.sh <token> <hook> [fee] [tickSpacing]}"
FEE="${3:-10000}"
TICK_SPACING="${4:-200}"
RPC="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"

USDC=0x3600000000000000000000000000000000000000
QUOTER=0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94
STATE_VIEW=0xF3334192D15450CdD385c8B70e03f9A6bD9E673b

# USDC's address sorts below any normally-deployed token, so it is currency0.
KEY="($USDC,$TOKEN,$FEE,$TICK_SPACING,$HOOK)"
PID=$(cast keccak "$(cast abi-encode 'f((address,address,uint24,int24,address))' "$KEY")")
SIG="quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))(uint256,uint256)"

BLK=$(cast block-number --rpc-url "$RPC")
echo "pool   $PID"
echo "block  $BLK (everything below is read at this block)"

SQRT=$(cast call $STATE_VIEW "getSlot0(bytes32)(uint160,int24,uint24,uint24)" "$PID" --block "$BLK" --rpc-url "$RPC" | head -1 | awk '{print $1}')
LIQ=$(cast call $STATE_VIEW "getLiquidity(bytes32)(uint128)" "$PID" --block "$BLK" --rpc-url "$RPC" | head -1 | awk '{print $1}')
if [ "$SQRT" = "0" ]; then echo "pool is not initialized — check the fee tier and tick spacing"; exit 1; fi

# One USDC in, and roughly its value back out, so price impact stays negligible.
BUY=$(cast call $QUOTER "$SIG" "($KEY,true,1000000,0x)" --block "$BLK" --rpc-url "$RPC" | head -1 | awk '{print $1}')
SELL_IN=$(node -e 'console.log(BigInt(Math.floor(Number(process.argv[1])*0.99)).toString())' "$BUY")
SELL=$(cast call $QUOTER "$SIG" "($KEY,false,$SELL_IN,0x)" --block "$BLK" --rpc-url "$RPC" | head -1 | awk '{print $1}')

node -e '
const [S,L,B,SIN,SOUT,fee] = process.argv.slice(1);
const sqrtP = Number(S)/2**96, l = Number(L), lp = Number(fee)/1e6;

// v4 takes the pool fee off the input, then moves along the curve.
const buyExpected  = (a) => { const n=a*(1-lp); return l*(sqrtP - 1/(1/sqrtP + n/l)); };
const sellExpected = (a) => { const n=a*(1-lp); return l*(1/sqrtP - 1/(sqrtP + n/l)); };

const be = buyExpected(1e6), se = sellExpected(Number(SIN));
const buyBps  = ((be-Number(B))/be)*10000;
const sellBps = ((se-Number(SOUT))/se)*10000;

console.log("pool fee              ", (lp*100).toFixed(2)+"%  (this is what stakers earn)");
console.log("hook tax on buys      ", buyBps.toFixed(0)+" bps");
console.log("hook tax on sells     ", sellBps.toFixed(0)+" bps");
console.log("total cost per swap   ", ((lp*10000)+ (buyBps+sellBps)/2).toFixed(0)+" bps");
console.log("");
console.log("For Slice: two-sided deposits and withdrawals never swap, so they pay none of this.");
console.log("A USDC-only deposit swaps half the input, so it pays about",
  (((lp*10000)+buyBps)/2/100).toFixed(2)+"% of the deposit.");
' "$SQRT" "$LIQ" "$BUY" "$SELL_IN" "$SELL" "$FEE"
