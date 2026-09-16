"use client";

import Link from "next/link";
import { useAccount } from "wagmi";

import { ConnectPrompt, NothingStaked, NotDeployed } from "@/components/Empty";
import { PairAvatar, SectionHeading, StatBar } from "@/components/ui";
import { useVaults } from "@/hooks/useVaults";
import { formatAmount, formatUsd, formatUsdCompact } from "@/lib/format";

export default function StakesPage() {
  const { isConnected } = useAccount();
  const { vaults, isLoading, configured } = useVaults();

  if (!configured) return <NotDeployed />;

  const mine = vaults.filter((v) => v.userShares > 0n || v.userEarned > 0n);
  const claimable = mine.reduce((acc, v) => acc + v.userEarned, 0n);
  const staked = mine.reduce((acc, v) => {
    if (v.totalSupply === 0n) return acc;
    return acc + (v.tvlUsdc * v.userShares) / v.totalSupply;
  }, 0n);

  return (
    <div>
      <SectionHeading
        title="Stakes"
        subtitle="Your staked liquidity and the USDC each position has streamed to you. Rewards accrue per second and stay with whoever earned them — transferring shares does not carry unclaimed rewards along."
      />

      {!isConnected ? (
        <ConnectPrompt />
      ) : isLoading && vaults.length === 0 ? (
        <div className="panel px-6 py-14 text-center text-sm text-[var(--color-muted)]">
          Loading your positions…
        </div>
      ) : mine.length === 0 ? (
        <NothingStaked />
      ) : (
        <>
          <div className="panel px-6 py-5">
            <StatBar
              items={[
                { label: "Position value", value: formatUsdCompact(staked) },
                { label: "Claimable USDC", value: formatUsd(claimable), tone: "accent" },
                { label: "Positions", value: String(mine.length) },
                {
                  label: "Streaming now",
                  value: String(mine.filter((v) => v.rewardRate > 0n).length),
                },
              ]}
            />
          </div>

          <div className="panel mt-5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="label px-4 py-3 pl-6 font-medium">Pool</th>
                    <th className="label px-4 py-3 text-right font-medium">Shares</th>
                    <th className="label px-4 py-3 text-right font-medium">Value</th>
                    <th className="label px-4 py-3 text-right font-medium">Claimable</th>
                    <th className="label px-4 py-3 pr-6 text-right font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-row">
                  {mine.map((v) => {
                    const value =
                      v.totalSupply === 0n ? 0n : (v.tvlUsdc * v.userShares) / v.totalSupply;
                    return (
                      <tr key={v.address} className="row-hover">
                        <td className="py-3.5 pl-6 pr-4">
                          <Link href={`/vault/${v.address}`} className="flex items-center gap-3">
                            <PairAvatar address={v.assetToken} symbol={v.symbol} />
                            <span className="text-sm font-semibold">
                              {v.symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
                            </span>
                          </Link>
                        </td>
                        <td className="num px-4 py-3.5 text-right text-sm text-[var(--color-muted)]">
                          {formatAmount(v.userShares, 18, 4)}
                        </td>
                        <td className="num px-4 py-3.5 text-right text-sm">
                          {formatUsdCompact(value)}
                        </td>
                        <td className="num px-4 py-3.5 text-right text-sm">
                          <span
                            className={v.userEarned > 0n ? "font-semibold text-[var(--color-up)]" : ""}
                          >
                            {formatUsd(v.userEarned)}
                          </span>
                        </td>
                        <td className="py-3.5 pl-4 pr-6 text-right">
                          <Link
                            href={`/vault/${v.address}`}
                            className="btn btn-ghost px-3 py-1.5 text-xs"
                          >
                            Manage
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
