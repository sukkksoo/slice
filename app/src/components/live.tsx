"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Marquee, Sparkline } from "@/components/motion";
import { PairAvatar } from "@/components/ui";
import { useVaults, type VaultSummary } from "@/hooks/useVaults";
import { formatPercent, formatUsdCompact } from "@/lib/format";

/**
 * A running band of live pool figures.
 *
 * Deliberately built from the same on-chain reads the rest of the app uses rather than from
 * decorative filler: a ticker showing invented numbers on a page asking for deposits is a lie,
 * and one showing real ones is the single clearest signal that the protocol is actually running.
 * With no vaults yet it renders nothing at all, rather than scrolling zeroes.
 */
export function LiveTicker() {
  const { vaults } = useVaults();
  if (vaults.length === 0) return null;

  // A short list would leave a visible gap mid-loop, so it is repeated until the track is long
  // enough for the seam to fall off-screen.
  const items = vaults.length >= 4 ? vaults : Array.from({ length: 4 }, (_, i) => vaults[i % vaults.length]!);

  return (
    <div className="panel edge-run overflow-hidden py-3">
      <Marquee durationSec={46}>
        {items.map((v, i) => (
          <TickerItem key={`${v.address}-${i}`} v={v} />
        ))}
      </Marquee>
    </div>
  );
}

function TickerItem({ v }: { v: VaultSummary }) {
  return (
    <Link
      href={`/vault/${v.address}`}
      className="group flex items-center gap-3 border-r border-[var(--color-border)] px-6 transition-colors hover:bg-[var(--color-surface-2)]"
    >
      <PairAvatar address={v.assetToken} symbol={v.symbol} />
      <div className="whitespace-nowrap">
        <div className="text-[13px] font-semibold">
          {v.symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
        </div>
        <div className="num text-[11px] text-[var(--color-muted)]">
          TVL {formatUsdCompact(v.tvlUsdc)}
          {v.rewardRate > 0n && (
            <span className="ml-2 text-[var(--color-up)]">{formatPercent(v.aprPercent)} APR</span>
          )}
        </div>
      </div>
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          v.canSwap ? "bg-[var(--color-up)] live-dot" : "bg-[var(--color-warn)]"
        }`}
        aria-hidden
      />
    </Link>
  );
}

/**
 * A price line for a pool, built by sampling while the page is open.
 *
 * There is no indexer behind this, so there is no history to load — the series starts empty and
 * fills as the app polls. That is stated rather than hidden: a chart that silently shows five
 * minutes of data while implying a trend would be worse than one that says how long it has been
 * watching.
 */
export function LivePrice({ vault }: { vault?: VaultSummary }) {
  const [series, setSeries] = useState<number[]>([]);
  const started = useRef(Date.now());

  useEffect(() => {
    if (!vault || vault.sqrtPriceX96 === 0n) return;
    // Squaring the sqrt price gives the pool price; the absolute scale does not matter here
    // because the sparkline normalises to its own range.
    const Q = 2 ** 96;
    const price = (Number(vault.sqrtPriceX96) / Q) ** 2;
    setSeries((s) => (s.length > 0 && s[s.length - 1] === price ? s : [...s, price].slice(-60)));
  }, [vault]);

  if (!vault) return null;

  const watchedSec = Math.round((Date.now() - started.current) / 1000);
  const first = series[0];
  const last = series[series.length - 1];
  const changePct = first && last ? ((last - first) / first) * 100 : 0;

  return (
    <div className="panel px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="label">{vault.symbol} price, live</div>
          <p className="mt-1 text-[11px] text-[var(--color-dim)]">
            {series.length < 2
              ? "sampling…"
              : `${series.length} samples over ${watchedSec < 90 ? `${watchedSec}s` : `${Math.round(watchedSec / 60)}m`} on this page`}
          </p>
        </div>
        {series.length >= 2 && (
          <div
            className={`num text-[13px] font-semibold ${
              changePct >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"
            }`}
          >
            {changePct >= 0 ? "+" : ""}
            {changePct.toFixed(2)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <Sparkline points={series} width={300} height={56} />
      </div>
    </div>
  );
}
