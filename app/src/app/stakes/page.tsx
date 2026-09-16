"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { ConnectPrompt, NothingStaked, NotDeployed } from "@/components/Empty";
import {
  Action,
  SlippageControl,
  TxStatus,
  useAfterConfirm,
  useNetworkGuard,
  useSlippage,
} from "@/components/tx";
import { PairAvatar, SectionHeading, StatBar } from "@/components/ui";
import { useVaults, type VaultSummary } from "@/hooks/useVaults";
import { vaultAbi } from "@/lib/contracts";
import { formatSig, formatUsd, formatUsdCompact } from "@/lib/format";
import { withSlippage } from "@/lib/preview";

export default function StakesPage() {
  const guard = useNetworkGuard();
  const account = guard.account;
  const { vaults, isLoading, configured, refetch } = useVaults();
  const { bps, setBps } = useSlippage();

  const { writeContract, writeContractAsync, data: txHash, isPending, error, reset } =
    useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || receipt.isLoading;
  const [claimingAll, setClaimingAll] = useState(false);

  const onConfirmed = useCallback(() => refetch(), [refetch]);
  useAfterConfirm(txHash, receipt.isSuccess, onConfirmed);

  if (!configured) return <NotDeployed />;

  const mine = vaults.filter((v) => v.userShares > 0n || v.userEarned > 0n);
  const claimable = mine.reduce((acc, v) => acc + v.userEarned, 0n);
  const staked = mine.reduce((acc, v) => {
    if (v.totalSupply === 0n) return acc;
    return acc + (v.tvlUsdc * v.userShares) / v.totalSupply;
  }, 0n);
  const withClaims = mine.filter((v) => v.userEarned > 0n);

  const claim = (v: VaultSummary) => {
    reset();
    writeContract({ address: v.address, abi: vaultAbi, functionName: "claim" });
  };

  // Wallets sign one transaction at a time, so "claim all" is a sequence, not a batch. Each
  // waits for the previous signature; a rejection stops the run rather than skipping ahead.
  const claimAll = async () => {
    reset();
    setClaimingAll(true);
    try {
      for (const v of withClaims) {
        await writeContractAsync({ address: v.address, abi: vaultAbi, functionName: "claim" });
      }
    } catch {
      /* the hook's own error state shows what happened */
    } finally {
      setClaimingAll(false);
    }
  };

  const unstake = (v: VaultSummary, min0: bigint, min1: bigint) => {
    reset();
    writeContract({
      address: v.address,
      abi: vaultAbi,
      functionName: "withdraw",
      args: [v.userShares, min0, min1, account],
    });
  };

  return (
    <div>
      <SectionHeading
        title="Stakes"
        subtitle="Your staked liquidity and the USDC each position has streamed to you. Rewards accrue per second and stay with whoever earned them — transferring shares does not carry unclaimed rewards along."
        action={
          withClaims.length > 1 && !guard.wrongChain ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || claimingAll}
              onClick={claimAll}
            >
              {claimingAll ? "Claiming…" : `Claim all · ${formatUsd(claimable)}`}
            </button>
          ) : undefined
        }
      />

      {!account ? (
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
              <table className="w-full min-w-[820px] text-left">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="label px-4 py-3 pl-6 font-medium">Pool</th>
                    <th className="label px-4 py-3 text-right font-medium">Shares</th>
                    <th className="label px-4 py-3 text-right font-medium">Value</th>
                    <th className="label px-4 py-3 text-right font-medium">Claimable</th>
                    <th className="label px-4 py-3 pr-6 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-row">
                  {mine.map((v) => (
                    <PositionRow
                      key={v.address}
                      v={v}
                      bps={bps}
                      busy={busy || claimingAll}
                      guard={guard}
                      onClaim={() => claim(v)}
                      onUnstake={(m0, m1) => unstake(v, m0, m1)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-6 py-3">
              <SlippageControl bps={bps} setBps={setBps} />
              <span className="text-[11px] text-[var(--color-dim)]">
                Unstake sends the whole position with a minimum written into the transaction.
                Partial withdrawals are on each pool&apos;s page.
              </span>
            </div>
          </div>

          <div className="mt-5">
            <TxStatus
              hash={txHash}
              isPending={isPending}
              isConfirming={receipt.isLoading}
              isSuccess={receipt.isSuccess}
              error={error}
            />
          </div>
        </>
      )}
    </div>
  );
}

function PositionRow({
  v,
  bps,
  busy,
  guard,
  onClaim,
  onUnstake,
}: {
  v: VaultSummary;
  bps: number;
  busy: boolean;
  guard: ReturnType<typeof useNetworkGuard>;
  onClaim: () => void;
  onUnstake: (min0: bigint, min1: bigint) => void;
}) {
  // What the whole position redeems for right now, so the unstake carries a real floor.
  const redeem = useReadContract({
    address: v.address,
    abi: vaultAbi,
    functionName: "previewRedeem",
    args: [v.userShares],
    query: { enabled: v.userShares > 0n, refetchInterval: 15_000 },
  });
  const [a0, a1] = (redeem.data as [bigint, bigint] | undefined) ?? [0n, 0n];
  const quoted = redeem.isSuccess && (a0 > 0n || a1 > 0n);

  const value = v.totalSupply === 0n ? 0n : (v.tvlUsdc * v.userShares) / v.totalSupply;

  return (
    <tr className="row-hover">
      <td className="py-3.5 pl-6 pr-4">
        <Link href={`/vault/${v.address}`} className="flex items-center gap-3">
          <PairAvatar address={v.assetToken} symbol={v.symbol} />
          <span className="text-sm font-semibold">
            {v.symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
          </span>
        </Link>
      </td>
      <td className="num px-4 py-3.5 text-right text-sm text-[var(--color-muted)]">
        {formatSig(v.userShares, 18)}
      </td>
      <td className="num px-4 py-3.5 text-right text-sm">{formatUsdCompact(value)}</td>
      <td className="num px-4 py-3.5 text-right text-sm">
        <span className={v.userEarned > 0n ? "font-semibold text-[var(--color-up)]" : ""}>
          {formatUsd(v.userEarned)}
        </span>
      </td>
      <td className="py-3.5 pl-4 pr-6">
        <div className="flex justify-end gap-2">
          <div className="w-28">
            <Action
              guard={guard}
              busy={busy}
              disabled={v.userEarned === 0n}
              onClick={onClaim}
              label="Claim"
              variant={v.userEarned > 0n ? "primary" : "ghost"}
            />
          </div>
          <div className="w-28">
            <Action
              guard={guard}
              busy={busy}
              disabled={v.userShares === 0n || !quoted}
              onClick={() => onUnstake(withSlippage(a0, bps), withSlippage(a1, bps))}
              label="Unstake"
              variant="ghost"
            />
          </div>
          <Link href={`/vault/${v.address}`} className="btn btn-ghost px-3 py-1.5 text-xs">
            Manage
          </Link>
        </div>
      </td>
    </tr>
  );
}
