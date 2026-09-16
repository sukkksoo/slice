"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { ConnectPrompt, NotDeployed } from "@/components/Empty";
import {
  Action,
  SlippageControl,
  TxStatus,
  useAfterConfirm,
  useNetworkGuard,
  useSlippage,
} from "@/components/tx";
import { Badge, PairAvatar, SectionHeading, Stat } from "@/components/ui";
import { useVaults, type VaultSummary } from "@/hooks/useVaults";
import { targetChain } from "@/lib/chain";
import { vaultAbi } from "@/lib/contracts";
import { formatAmount, formatSig, formatUsd, formatUsdCompact, shortAddress } from "@/lib/format";
import { withSlippage } from "@/lib/preview";
import { explorerAddress, explorerTx } from "@/lib/tx";

type Created = {
  vaults: { vault: string; poolId: string; block: number; tx: string }[];
  routers: { router: string; vault: string; block: number; tx: string }[];
};

/**
 * Everything tied to one wallet, in one place.
 *
 * Previously this was a dropdown holding an address and a disconnect button, and a separate page
 * listing staked positions. Pools somebody had listed appeared nowhere at all — the factory
 * records which vault serves a pool, not who asked for it, so a person who created one had no way
 * to find it again except by remembering the address.
 */
export default function AccountPage() {
  const guard = useNetworkGuard();
  const account = guard.account;
  const { vaults, isLoading, configured, refetch } = useVaults();
  const { bps, setBps } = useSlippage();

  const [created, setCreated] = useState<Created | null>(null);
  const [creating, setCreating] = useState(false);

  const balance = useBalance({
    address: account,
    chainId: targetChain.id,
    query: { enabled: Boolean(account) },
  });

  useEffect(() => {
    if (!account) {
      setCreated(null);
      return;
    }
    let cancelled = false;
    setCreating(true);
    fetch(`/api/account?address=${account.toLowerCase()}&chain=${targetChain.id}`)
      .then((r) => r.json())
      .then((d: Created & { error?: string }) => {
        if (!cancelled && !d.error) setCreated({ vaults: d.vaults ?? [], routers: d.routers ?? [] });
      })
      .catch(() => {})
      .finally(() => !cancelled && setCreating(false));
    return () => {
      cancelled = true;
    };
  }, [account]);

  const { writeContract, data: txHash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || receipt.isLoading;
  const onConfirmed = useCallback(() => refetch(), [refetch]);
  useAfterConfirm(txHash, receipt.isSuccess, onConfirmed);

  if (!configured) return <NotDeployed />;
  if (!account) {
    return (
      <div>
        <SectionHeading title="Your account" subtitle="Positions, pools you have listed, and everything tied to your wallet." />
        <ConnectPrompt />
      </div>
    );
  }

  const mine = vaults.filter((v) => v.userShares > 0n || v.userEarned > 0n);
  const claimable = mine.reduce((acc, v) => acc + v.userEarned, 0n);
  const staked = mine.reduce(
    (acc, v) => (v.totalSupply === 0n ? acc : acc + (v.tvlUsdc * v.userShares) / v.totalSupply),
    0n,
  );
  const dailyTotal = mine.reduce((acc, v) => {
    if (!(v.rewardRate > 0n) || v.totalSupply === 0n) return acc;
    return acc + (((v.rewardRate * 86_400n) / 10n ** 18n) * v.userShares) / v.totalSupply;
  }, 0n);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label">Your account</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">
            {shortAddress(account)}
          </h1>
          <a
            href={explorerAddress(account)}
            target="_blank"
            rel="noreferrer"
            className="mono mt-1 inline-block text-xs text-[var(--color-dim)] hover:text-[var(--color-muted)]"
          >
            {account} ↗
          </a>
        </div>
        <button type="button" onClick={() => guard.wrongChain && guard.switchToTarget()} className="btn btn-ghost">
          {guard.wrongChain ? `Switch to ${targetChain.name}` : `Connected to ${targetChain.name}`}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Staked" value={formatUsdCompact(staked)} />
        <Stat
          label="Claimable"
          value={formatUsd(claimable)}
          tone={claimable > 0n ? "accent" : "default"}
        />
        <Stat
          label="Earning"
          value={dailyTotal > 0n ? `${formatUsd(dailyTotal)}/d` : "—"}
          hint="at the current stream rate"
        />
        <Stat
          label="Gas balance"
          value={balance.data ? `${formatAmount(balance.data.value, balance.data.decimals, 2)}` : "—"}
          hint="USDC, for transaction fees"
        />
      </div>

      {/* --- positions --- */}
      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Your positions</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Liquidity you have staked, and the USDC each position has streamed to you.
            </p>
          </div>
          <SlippageControl bps={bps} setBps={setBps} />
        </div>

        {isLoading && vaults.length === 0 ? (
          <div className="panel px-6 py-10 text-center text-sm text-[var(--color-muted)]">
            Loading positions…
          </div>
        ) : mine.length === 0 ? (
          <div className="panel px-6 py-10 text-center">
            <p className="text-sm text-[var(--color-muted)]">
              Nothing staked yet. Deposit into a pool to start earning a share of its trading fees.
            </p>
            <Link href="/pools" className="btn btn-primary mt-5">
              Browse pools
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {mine.map((v) => (
              <PositionCard
                key={v.address}
                v={v}
                bps={bps}
                busy={busy}
                guard={guard}
                account={account}
                onWrite={(fn, args) => {
                  reset();
                  writeContract({ address: v.address, abi: vaultAbi, functionName: fn, args });
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* --- pools this wallet listed --- */}
      <section>
        <div className="mb-4">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Pools you listed</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">
            Vaults created from this wallet. Listing a pool gives you no rights over it — owner and
            fee recipient are set by the factory, identically for every vault — so this is a record,
            not a control panel.
          </p>
        </div>

        {creating ? (
          <div className="panel px-6 py-8 text-center text-sm text-[var(--color-muted)]">
            Reading the chain…
          </div>
        ) : !created || created.vaults.length === 0 ? (
          <div className="panel px-6 py-8 text-center">
            <p className="text-sm text-[var(--color-muted)]">
              You have not listed a pool from this wallet.
            </p>
            <Link href="/pools/new" className="btn btn-ghost mt-4">
              List a pool
            </Link>
          </div>
        ) : (
          <div className="panel divide-y divide-[var(--color-border)]">
            {created.vaults.map((c) => {
              const known = vaults.find((v) => v.address.toLowerCase() === c.vault.toLowerCase());
              return (
                <div key={c.vault} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  {known ? (
                    <PairAvatar address={known.assetToken} symbol={known.symbol} />
                  ) : (
                    <span className="size-9 rounded-full bg-[var(--color-surface-3)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {known ? (
                        <>
                          {known.symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
                        </>
                      ) : (
                        "Vault"
                      )}
                    </div>
                    <a
                      href={explorerTx(c.tx as `0x${string}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="mono text-[11px] text-[var(--color-dim)] hover:text-[var(--color-muted)]"
                    >
                      listed in block {c.block.toLocaleString()} ↗
                    </a>
                  </div>
                  {known && (
                    <Badge tone={known.canSwap ? "up" : "warn"}>
                      {known.canSwap ? "Live" : "Warming"}
                    </Badge>
                  )}
                  <Link href={`/vault/${c.vault}`} className="btn btn-ghost px-3 py-1.5 text-xs">
                    Open
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* --- routers --- */}
      {created && created.routers.length > 0 && (
        <section>
          <div className="mb-4">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Your fee routers</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">
              Routers you deployed, which inject a funded USDC budget into pool liquidity on a
              schedule. Unspent budget stays yours.
            </p>
          </div>
          <div className="panel divide-y divide-[var(--color-border)]">
            {created.routers.map((r) => (
              <div key={r.router} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="mono text-sm font-semibold">{shortAddress(r.router)}</div>
                  <div className="text-[11px] text-[var(--color-dim)]">
                    injecting into {shortAddress(r.vault)}
                  </div>
                </div>
                <Link href="/creator" className="btn btn-ghost px-3 py-1.5 text-xs">
                  Manage
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <TxStatus
        hash={txHash}
        isPending={isPending}
        isConfirming={receipt.isLoading}
        isSuccess={receipt.isSuccess}
        error={error}
        successLabel="Confirmed — your figures have been refreshed."
      />
    </div>
  );
}

function PositionCard({
  v,
  bps,
  busy,
  guard,
  account,
  onWrite,
}: {
  v: VaultSummary;
  bps: number;
  busy: boolean;
  guard: ReturnType<typeof useNetworkGuard>;
  account: Address;
  onWrite: (fn: string, args?: unknown[]) => void;
}) {
  // What the whole position redeems for right now, so leaving carries a real floor rather than
  // the zero minimum that would let a sandwich take a cut on the way out.
  const redeem = useReadContract({
    chainId: targetChain.id,
    address: v.address,
    abi: vaultAbi,
    functionName: "previewRedeem",
    args: [v.userShares],
    query: { enabled: v.userShares > 0n, refetchInterval: 15_000 },
  });
  const [a0, a1] = (redeem.data as [bigint, bigint] | undefined) ?? [0n, 0n];
  const quoted = redeem.isSuccess && (a0 > 0n || a1 > 0n);

  const value = v.totalSupply === 0n ? 0n : (v.tvlUsdc * v.userShares) / v.totalSupply;
  const share = v.totalSupply > 0n ? Number((v.userShares * 1_000_000n) / v.totalSupply) / 10_000 : 0;

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center gap-4">
        <PairAvatar address={v.assetToken} symbol={v.symbol} />
        <div className="min-w-0 flex-1">
          <Link href={`/vault/${v.address}`} className="text-sm font-semibold hover:underline">
            {v.symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
          </Link>
          <div className="mono text-[11px] text-[var(--color-dim)]">
            {formatSig(v.userShares, 18)} shares · {share.toFixed(share < 0.01 ? 4 : 2)}% of the pool
          </div>
        </div>
        <Badge tone={v.canSwap ? "up" : "warn"}>{v.canSwap ? "Live" : "Warming"}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--color-border)] pt-4 sm:grid-cols-4">
        <Field label="Value" value={formatUsdCompact(value)} />
        <Field label="Claimable" value={formatUsd(v.userEarned)} accent={v.userEarned > 0n} />
        <Field label="USDC if you leave" value={formatUsd(v.usdcIsCurrency0 ? a0 : a1)} />
        <Field
          label={`${v.symbol} if you leave`}
          value={formatSig(v.usdcIsCurrency0 ? a1 : a0, 18)}
        />
      </dl>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Action
          guard={guard}
          busy={busy}
          disabled={v.userEarned === 0n}
          onClick={() => onWrite("claim")}
          label={v.userEarned > 0n ? `Claim ${formatUsd(v.userEarned)}` : "Nothing to claim"}
          variant={v.userEarned > 0n ? "primary" : "ghost"}
        />
        <Action
          guard={guard}
          busy={busy}
          disabled={v.userShares === 0n || !quoted}
          onClick={() =>
            onWrite("withdraw", [
              v.userShares,
              withSlippage(a0, bps),
              withSlippage(a1, bps),
              account,
            ])
          }
          label="Unstake everything"
          variant="ghost"
        />
        <Link href={`/vault/${v.address}`} className="btn btn-ghost w-full">
          Add or withdraw part
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={`num mt-1 text-[13px] ${accent ? "font-semibold text-[var(--color-up)]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
