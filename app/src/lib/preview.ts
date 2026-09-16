/**
 * Client-side previews of what a vault call will do, so the UI can pass real minimums.
 *
 * The vault takes `minShares` on deposit and `amount0Min`/`amount1Min` on withdraw precisely so a
 * caller cannot be sandwiched. A UI that passes zeros throws that protection away. Everything
 * here mirrors the contract's own arithmetic so the minimum sent is a genuine floor on what the
 * call would return at the quoted price, less the tolerance the person chose.
 */

const Q96 = 1n << 96n;
const BPS = 10_000n;

/** Mirrors `MINIMUM_SHARES` in LiquidityVault.sol — burned on the first deposit. */
const MINIMUM_SHARES = 1_000n;

/** Uniswap's dynamic-fee flag. A pool carrying it does not expose its fee in the key. */
const DYNAMIC_FEE_FLAG = 0x800000;

export function isDynamicFee(fee: number): boolean {
  return (fee & DYNAMIC_FEE_FLAG) !== 0;
}

/** `x` reduced by `bps` basis points, rounding against the caller. */
export function withSlippage(x: bigint, bps: number): bigint {
  return (x * (BPS - BigInt(bps))) / BPS;
}

/** What is left of `amount` after the vault's entry fee — mirrors `_chargeDepositFee`. */
export function afterEntryFee(amount: bigint, feeBps: number): bigint {
  return amount - (amount * BigInt(feeBps)) / BPS;
}

// --- exact port of v4-periphery LiquidityAmounts, in bigint ---------------------------------

function liquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const intermediate = (sqrtA * sqrtB) / Q96;
  return (amount0 * intermediate) / (sqrtB - sqrtA);
}

function liquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (amount1 * Q96) / (sqrtB - sqrtA);
}

/** The liquidity a position between `sqrtA` and `sqrtB` gets for these amounts at `sqrtP`. */
export function liquidityForAmounts(
  sqrtP: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtP <= sqrtA) return liquidityForAmount0(sqrtA, sqrtB, amount0);
  if (sqrtP < sqrtB) {
    const l0 = liquidityForAmount0(sqrtP, sqrtB, amount0);
    const l1 = liquidityForAmount1(sqrtA, sqrtP, amount1);
    return l0 < l1 ? l0 : l1;
  }
  return liquidityForAmount1(sqrtA, sqrtB, amount1);
}

/** Shares minted for `liquidity` — mirrors `_mintShares`. */
export function sharesForLiquidity(
  liquidity: bigint,
  totalSupply: bigint,
  totalLiquidity: bigint,
): bigint {
  if (totalSupply === 0n) return liquidity > MINIMUM_SHARES ? liquidity - MINIMUM_SHARES : 0n;
  if (totalLiquidity === 0n) return 0n;
  return (liquidity * totalSupply) / totalLiquidity;
}

/** Convert a USDC amount to the asset at the pool's spot price — the inverse of `tokenValueInUsdc`. */
export function usdcToAsset(usdc: bigint, sqrtP: bigint, usdcIsCurrency0: boolean): bigint {
  if (sqrtP === 0n) return 0n;
  return usdcIsCurrency0
    ? (((usdc * sqrtP) / Q96) * sqrtP) / Q96
    : (((usdc * Q96) / sqrtP) * Q96) / sqrtP;
}

export type PoolShape = {
  sqrtP: bigint;
  sqrtLower: bigint;
  sqrtUpper: bigint;
  usdcIsCurrency0: boolean;
  totalSupply: bigint;
  totalLiquidity: bigint;
  depositFeeBps: number;
};

/** Shares a two-sided deposit would mint at the current price. Exact, bar rounding. */
export function previewDepositPair(usdc: bigint, asset: bigint, pool: PoolShape): bigint {
  const netUsdc = afterEntryFee(usdc, pool.depositFeeBps);
  const netAsset = afterEntryFee(asset, pool.depositFeeBps);
  const [a0, a1] = pool.usdcIsCurrency0 ? [netUsdc, netAsset] : [netAsset, netUsdc];
  const liquidity = liquidityForAmounts(pool.sqrtP, pool.sqrtLower, pool.sqrtUpper, a0, a1);
  return sharesForLiquidity(liquidity, pool.totalSupply, pool.totalLiquidity);
}

/**
 * Shares a USDC-only deposit would mint, assuming the internal swap fills at spot.
 *
 * This is an estimate, not a quote: it accounts for the pool's LP fee but not for the swap's own
 * price impact or any hook tax. That makes it slightly optimistic, which is the right direction
 * for a floor — the tolerance applied on top is what absorbs the difference. On a pool with a
 * taxed hook the shortfall is systematic, and the UI says so where it shows this figure.
 */
export function previewDepositUsdc(usdc: bigint, lpFeePips: number, pool: PoolShape): bigint {
  const net = afterEntryFee(usdc, pool.depositFeeBps);
  const swapIn = net / 2n;
  const swapInAfterFee = isDynamicFee(lpFeePips)
    ? swapIn
    : swapIn - (swapIn * BigInt(lpFeePips)) / 1_000_000n;
  const assetOut = usdcToAsset(swapInAfterFee, pool.sqrtP, pool.usdcIsCurrency0);
  const remaining = net - swapIn;
  const [a0, a1] = pool.usdcIsCurrency0 ? [remaining, assetOut] : [assetOut, remaining];
  const liquidity = liquidityForAmounts(pool.sqrtP, pool.sqrtLower, pool.sqrtUpper, a0, a1);
  return sharesForLiquidity(liquidity, pool.totalSupply, pool.totalLiquidity);
}
