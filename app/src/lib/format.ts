const Q96 = 1n << 96n;

/** Format a raw token amount with `decimals` places as a short human string. */
export function formatAmount(raw: bigint, decimals: number, maxFractionDigits = 2): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;

  const fractionStr = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFractionDigits)
    .replace(/0+$/, "");

  const wholeStr = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeStr}${fractionStr ? `.${fractionStr}` : ""}`;
}

export function formatUsd(raw6: bigint): string {
  return `$${formatAmount(raw6, 6, 2)}`;
}

/** Compact USD for table cells: $1.2M, $840.5K, $312. */
export function formatUsdCompact(raw6: bigint): string {
  const units = Number(raw6) / 1e6;
  if (!Number.isFinite(units)) return "—";
  const abs = Math.abs(units);
  if (abs >= 1_000_000_000) return `$${(units / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(units / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(units / 1_000).toFixed(1)}K`;
  return `$${units.toFixed(2)}`;
}

export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Value a token amount in 6-decimal USDC at a Uniswap sqrt price.
 *
 * Uniswap quotes raw units against raw units (price = amount1 / amount0), so a pool holding
 * 6-decimal USDC against an 18-decimal token needs no separate decimal adjustment here — only the
 * right direction. Each multiply is split in two steps because sqrtPriceX96 squared overflows the
 * range where JS bigints stay cheap.
 */
export function tokenValueInUsdc(
  tokenAmountRaw: bigint,
  sqrtPriceX96: bigint,
  usdcIsCurrency0: boolean,
): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  return usdcIsCurrency0
    ? // USDC is currency0, so the pool price is token-per-USDC; invert it.
      ((tokenAmountRaw * Q96) / sqrtPriceX96) * Q96 / sqrtPriceX96
    : // Token is currency0, so the pool price is already USDC-per-token.
      ((tokenAmountRaw * sqrtPriceX96) / Q96) * sqrtPriceX96 / Q96;
}

/**
 * Annualised percentage return implied by the vault's current reward stream.
 *
 * `rewardRate` is reward units per second scaled by 1e18. It reflects the most recent harvest
 * extrapolated forward, so it is a run-rate, not a realised return — a vault that has just been
 * harvested after a busy week will read high until the stream decays.
 */
export function streamApr(rewardRate: bigint, tvlUsdc6: bigint, periodFinish: bigint): number {
  if (tvlUsdc6 === 0n) return 0;
  if (periodFinish * 1000n < BigInt(Date.now())) return 0;

  const perYear = (rewardRate * 31_536_000n) / 10n ** 18n;
  return (Number(perYear) / Number(tvlUsdc6)) * 100;
}

/**
 * A token amount to `sig` significant figures.
 *
 * Vault shares are 18-decimal, but a 6-decimal/18-decimal pair mints liquidity in the millions of
 * units, not the quintillions — so a real position is something like 0.00000199 shares and a fixed
 * two- or four-decimal formatter renders every one of them as "0". Significant figures show the
 * number that is actually there.
 */
export function formatSig(raw: bigint, decimals: number, sig = 4): string {
  if (raw === 0n) return "0";
  const negative = raw < 0n;
  const full = formatAmount(negative ? -raw : raw, decimals, decimals).replace(/,/g, "");
  const [whole, frac = ""] = full.split(".");
  let out: string;
  if (whole !== "0") {
    const keep = Math.max(0, sig - whole.length);
    const cut = frac.slice(0, keep).replace(/0+$/, "");
    out = `${BigInt(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`;
  } else {
    const lead = (frac.match(/^0*/)?.[0] ?? "").length;
    const cut = frac.slice(0, lead + sig).replace(/0+$/, "");
    out = cut ? `0.${cut}` : "0";
  }
  return negative ? `-${out}` : out;
}
