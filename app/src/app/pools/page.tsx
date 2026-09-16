"use client";

import Link from "next/link";
import { useMemo } from "react";

import { NoVaults, NotDeployed } from "@/components/Empty";
import { Badge, LiveBadge, PairAvatar, SectionHeading, StatBar } from "@/components/ui";
import { MiniMeter } from "@/components/viz";
import { useVaults, type VaultSummary } from "@/hooks/useVaults";
import { formatPercent, formatUsdCompact, shortAddress } from "@/lib/format";

export default function PoolsPage() {
  const { vaults, isLoading, configured, error } = useVaults();

  const totals = useMemo(() => {
    const tvl = vaults.reduce((acc, v) => acc + v.tvlUsdc, 0n);
    const queued = vaults.reduce((acc, v) => acc + v.pendingCompound, 0n);
    const streaming = vaults.filter((v) => v.rewardRate > 0n).length;
    return { tvl, queued, streaming };
  }, [vaults]);

  const ranked = useMemo(
    () => [...vaults].sort((a, b) => (b.tvlUsdc > a.tvlUsdc ? 1 : b.tvlUsdc < a.tvlUsdc ? -1 : 0)),
    [vaults],
  );

  const topByApr = useMemo(
    () => [...vaults].filter((v) => v.rewardRate > 0n).sort((a, b) => b.aprPercent - a.aprPercent)[0],
    [vaults],
  );

  if (!configured) return <NotDeployed />;

  return (
    <div>
      <SectionHeading
        title="Pools"
        subtitle="Every vault holds one full-range Uniswap v4 position. Swap fees are harvested, converted to USDC, and streamed to stakers over seven days — so arriving right after a busy hour earns you nothing you did not provide liquidity for."
      />

      <div className="panel px-6 py-5">
        {isLoading && vaults.length === 0 ? (
          <div className="flex gap-9">
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <div className="skeleton h-3 w-20" />
                <div className="skeleton mt-2.5 h-6 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <StatBar
            items={[
              { label: "Total TVL", value: formatUsdCompact(totals.tvl) },
              { label: "Pools", value: String(vaults.length) },
              { label: "Streaming", value: String(totals.streaming), tone: "accent" },
              { label: "Queued to compound", value: formatUsdCompact(totals.queued) },
            ]}
          />
        )}
      </div>

      {error && (
        <div className="panel mt-5 border-[var(--color-danger)] px-5 py-4 text-sm text-[var(--color-danger)]">
          Failed to read from Arc: {error.message}
        </div>
      )}

      {topByApr && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Highlight label="Highest stream APR" vault={topByApr} value={formatPercent(topByApr.aprPercent)} />
          {ranked[0] && (
            <Highlight label="Deepest pool" vault={ranked[0]} value={formatUsdCompact(ranked[0].tvlUsdc)} />
          )}
        </div>
      )}

      <div className="mt-5">
        {isLoading && vaults.length === 0 ? (
          <TableSkeleton />
        ) : vaults.length === 0 ? (
          <NoVaults />
        ) : (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <Th className="pl-6">Pool</Th>
                    <Th align="right">TVL</Th>
                    <Th align="right">Stream APR</Th>
                    <Th align="right">Queued</Th>
                    <Th align="right">Fee split</Th>
                    <Th align="right">Oracle</Th>
                    <Th align="right" className="pr-6">
                      Your stake
                    </Th>
                  </tr>
                </thead>
                <tbody className="divide-row">
                  {ranked.map((v) => (
                    <tr key={v.address} className="row-hover">
                      <td className="py-3.5 pl-6 pr-4">
                        <Link href={`/vault/${v.address}`} className="flex items-center gap-3">
                          <PairAvatar address={v.assetToken} symbol={v.symbol} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">
                              {v.symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
                            </span>
                            <span className="mono block text-[11px] text-[var(--color-dim)]">
                              {shortAddress(v.address)}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <Td>{formatUsdCompact(v.tvlUsdc)}</Td>
                      <td className="px-4 py-3.5 text-right">
                        {v.rewardRate > 0n ? (
                          <div className="ml-auto w-24">
                            <div className="num text-sm font-semibold text-[var(--color-up)]">
                              {formatPercent(v.aprPercent)}
                            </div>
                            <div className="mt-1.5">
                              {/* Capped at 50% so one hot pool does not flatten every other bar. */}
                              <MiniMeter pct={(v.aprPercent / 50) * 100} tone="up" />
                            </div>
                          </div>
                        ) : (
                          <span className="num text-sm text-[var(--color-dim)]">—</span>
                        )}
                      </td>
                      <Td muted>{formatUsdCompact(v.pendingCompound)}</Td>
                      <Td muted>{(v.streamBps / 100).toFixed(0)}% stream</Td>
                      <td className="px-4 py-3.5 text-right">
                        <LiveBadge warm={v.oracleWarm} />
                      </td>
                      <td className="py-3.5 pl-4 pr-6 text-right">
                        {v.userShares > 0n ? (
                          <Badge tone="accent">Staked</Badge>
                        ) : (
                          <Link
                            href={`/vault/${v.address}`}
                            className="btn btn-ghost px-3 py-1.5 text-xs"
                          >
                            Stake
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-[var(--color-dim)]">
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

function Highlight({
  label,
  vault,
  value,
}: {
  label: string;
  vault: VaultSummary;
  value: string;
}) {
  return (
    <Link href={`/vault/${vault.address}`} className="panel-raised flex items-center gap-4 p-5">
      <PairAvatar address={vault.assetToken} symbol={vault.symbol} />
      <div className="min-w-0 flex-1">
        <div className="label">{label}</div>
        <div className="mt-1 truncate text-sm font-semibold">
          {vault.symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
        </div>
      </div>
      <div className="num text-xl font-semibold text-[var(--color-accent)]">{value}</div>
    </Link>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`label px-4 py-3 font-medium ${align === "right" ? "text-right" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <td
      className={`num px-4 py-3.5 text-right text-sm ${muted ? "text-[var(--color-muted)]" : ""}`}
    >
      {children}
    </td>
  );
}

function TableSkeleton() {
  return (
    <div className="panel divide-row overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-6 py-4">
          <div className="skeleton size-9 rounded-full" />
          <div className="flex-1">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton mt-1.5 h-3 w-20" />
          </div>
          <div className="skeleton h-4 w-16" />
          <div className="skeleton h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
