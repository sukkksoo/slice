"use client";

import Link from "next/link";
import { useAccount } from "wagmi";

import { NotDeployed } from "@/components/Empty";
import { Stat } from "@/components/Stat";
import { useVaults } from "@/hooks/useVaults";
import { formatAmount, formatUsd, formatUsdCompact } from "@/lib/format";

export default function StakesPage() {
  const { isConnected } = useAccount();
  const { vaults, isLoading, configured } = useVaults();

  if (!configured) return <NotDeployed />;

  const mine = vaults.filter((v) => v.userShares > 0n || v.userEarned > 0n);
  const claimable = mine.reduce((acc, v) => acc + v.userEarned, 0n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Stakes</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--color-muted)]">
          Your staked liquidity and the USDC each position has streamed to you so far. Rewards
          accrue per second and follow share transfers, so moving shares carries the unclaimed
          balance with the sender, not the shares.
        </p>
      </div>

      {!isConnected ? (
        <div className="panel px-6 py-10 text-center text-xs text-[var(--color-muted)]">
          Connect a wallet to see your positions.
        </div>
      ) : isLoading && vaults.length === 0 ? (
        <div className="panel px-6 py-10 text-center text-xs text-[var(--color-muted)]">Loading…</div>
      ) : mine.length === 0 ? (
        <div className="panel px-6 py-10 text-center">
          <div className="text-sm font-semibold">Nothing staked</div>
          <Link
            href="/"
            className="mt-4 inline-block rounded bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-black"
          >
            Browse pools
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Positions" value={String(mine.length)} />
            <Stat label="Claimable USDC" value={formatUsd(claimable)} tone={claimable > 0n ? "accent" : "default"} />
            <Stat
              label="Streaming now"
              value={String(mine.filter((v) => v.rewardRate > 0n).length)}
            />
          </div>

          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-4 py-3 font-medium">Pool</th>
                  <th className="px-4 py-3 text-right font-medium">Shares</th>
                  <th className="px-4 py-3 text-right font-medium">Pool TVL</th>
                  <th className="px-4 py-3 text-right font-medium">Claimable</th>
                  <th className="px-4 py-3 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {mine.map((v) => (
                  <tr key={v.address} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 font-semibold">{v.symbol} / USDC</td>
                    <td className="num px-4 py-3 text-right">{formatAmount(v.userShares, 18, 4)}</td>
                    <td className="num px-4 py-3 text-right text-[var(--color-muted)]">
                      {formatUsdCompact(v.tvlUsdc)}
                    </td>
                    <td className="num px-4 py-3 text-right">
                      <span className={v.userEarned > 0n ? "text-[var(--color-accent)]" : ""}>
                        {formatUsd(v.userEarned)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/vault/${v.address}`}
                        className="rounded border border-[var(--color-border)] px-3 py-1 hover:border-[var(--color-accent)]"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
