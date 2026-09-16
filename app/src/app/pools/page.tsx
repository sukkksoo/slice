"use client";

import Link from "next/link";
import { useMemo } from "react";

import { NoVaults, NotDeployed } from "@/components/Empty";
import { Stat } from "@/components/Stat";
import { useVaults } from "@/hooks/useVaults";
import { formatPercent, formatUsdCompact, shortAddress } from "@/lib/format";

export default function PoolsPage() {
  const { vaults, isLoading, configured, error } = useVaults();

  const totals = useMemo(() => {
    const tvl = vaults.reduce((acc, v) => acc + v.tvlUsdc, 0n);
    const queued = vaults.reduce((acc, v) => acc + v.pendingCompound, 0n);
    const streaming = vaults.filter((v) => v.rewardRate > 0n).length;
    return { tvl, queued, streaming };
  }, [vaults]);

  if (!configured) return <NotDeployed />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pools</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--color-muted)]">
          Every vault holds one full-range Uniswap v4 position. Swap fees are harvested, converted
          to USDC, and streamed to stakers over seven days rather than paid out in a lump — so
          arriving right after a busy hour earns you nothing you did not provide liquidity for.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total TVL" value={formatUsdCompact(totals.tvl)} />
        <Stat label="Vaults" value={String(vaults.length)} />
        <Stat label="Streaming" value={String(totals.streaming)} hint="vaults paying out now" />
        <Stat label="Queued to compound" value={formatUsdCompact(totals.queued)} />
      </div>

      {error && (
        <div className="panel border-[var(--color-danger)] px-4 py-3 text-xs text-[var(--color-danger)]">
          Failed to read from Arc: {error.message}
        </div>
      )}

      {isLoading && vaults.length === 0 ? (
        <div className="panel px-6 py-10 text-center text-xs text-[var(--color-muted)]">
          Reading vaults from Arc…
        </div>
      ) : vaults.length === 0 ? (
        <NoVaults />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-4 py-3 font-medium">Pool</th>
                <th className="px-4 py-3 text-right font-medium">TVL</th>
                <th className="px-4 py-3 text-right font-medium">Stream APR</th>
                <th className="px-4 py-3 text-right font-medium">Queued</th>
                <th className="px-4 py-3 text-right font-medium">Fee split</th>
                <th className="px-4 py-3 text-right font-medium">Oracle</th>
                <th className="px-4 py-3 text-right font-medium">Your stake</th>
              </tr>
            </thead>
            <tbody>
              {vaults.map((v) => (
                <tr
                  key={v.address}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-panel-2)]"
                >
                  <td className="px-4 py-3">
                    <Link href={`/vault/${v.address}`} className="group flex flex-col">
                      <span className="font-semibold group-hover:text-[var(--color-accent)]">
                        {v.symbol} / USDC
                      </span>
                      <span className="text-[11px] text-[var(--color-muted)]">
                        {shortAddress(v.address)}
                      </span>
                    </Link>
                  </td>
                  <td className="num px-4 py-3 text-right">{formatUsdCompact(v.tvlUsdc)}</td>
                  <td className="num px-4 py-3 text-right">
                    {v.rewardRate > 0n ? (
                      <span className="text-[var(--color-accent)]">
                        {formatPercent(v.aprPercent)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                  <td className="num px-4 py-3 text-right text-[var(--color-muted)]">
                    {formatUsdCompact(v.pendingCompound)}
                  </td>
                  <td className="num px-4 py-3 text-right text-[var(--color-muted)]">
                    {(v.streamBps / 100).toFixed(0)}% stream
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.oracleWarm ? (
                      <span className="text-[var(--color-accent)]">warm</span>
                    ) : (
                      <span
                        className="text-[var(--color-warn)]"
                        title="Automated swaps are deferred until the TWAP window fills"
                      >
                        warming
                      </span>
                    )}
                  </td>
                  <td className="num px-4 py-3 text-right">
                    {v.userShares > 0n ? (
                      <Link href={`/vault/${v.address}`} className="text-[var(--color-accent)]">
                        staked
                      </Link>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
        Stream APR annualises the current payout rate from the most recent harvest. It is a
        run-rate, not a realised return: it reads high right after heavy trading and decays as the
        seven-day stream unwinds.{" "}
        <Link href="/docs/fee-streaming" className="text-[var(--color-accent)] hover:underline">
          How the stream works →
        </Link>
      </p>
    </div>
  );
}
