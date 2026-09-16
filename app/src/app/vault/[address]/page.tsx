"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import type { Address } from "viem";
import { maxUint256, parseUnits } from "viem";
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { LiveBadge, PairAvatar, Stat } from "@/components/ui";
import { CompositionBar, FeeSplitBar, StreamRing } from "@/components/viz";
import { targetChain } from "@/lib/chain";
import { ARC, erc20Abi, vaultAbi } from "@/lib/contracts";
import {
  formatAmount,
  formatPercent,
  formatUsd,
  formatUsdCompact,
  shortAddress,
  streamApr,
  tokenValueInUsdc,
} from "@/lib/format";

type Mode = "usdc" | "pair";

export default function VaultPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: routeAddress } = use(params);
  const vault = routeAddress as Address;

  const { address: account } = useAccount();
  const holder = account ?? ("0x0000000000000000000000000000000000000000" as Address);

  const [mode, setMode] = useState<Mode>("usdc");
  const [usdcInput, setUsdcInput] = useState("");
  const [assetInput, setAssetInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");

  const reads = useReadContracts({
    contracts: [
      { address: vault, abi: vaultAbi, functionName: "symbol" },
      { address: vault, abi: vaultAbi, functionName: "assetCurrency" },
      { address: vault, abi: vaultAbi, functionName: "usdcIsCurrency0" },
      { address: vault, abi: vaultAbi, functionName: "totalSupply" },
      { address: vault, abi: vaultAbi, functionName: "prices" },
      { address: vault, abi: vaultAbi, functionName: "rewardRate" },
      { address: vault, abi: vaultAbi, functionName: "periodFinish" },
      { address: vault, abi: vaultAbi, functionName: "pendingCompound" },
      { address: vault, abi: vaultAbi, functionName: "pendingAssetFees" },
      { address: vault, abi: vaultAbi, functionName: "pendingProtocolFees" },
      { address: vault, abi: vaultAbi, functionName: "streamBps" },
      { address: vault, abi: vaultAbi, functionName: "protocolFeeBps" },
      { address: vault, abi: vaultAbi, functionName: "depositFeeBps" },
      { address: vault, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
      { address: vault, abi: vaultAbi, functionName: "earned", args: [holder] },
      { address: ARC.USDC, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
      { address: ARC.USDC, abi: erc20Abi, functionName: "allowance", args: [holder, vault] },
    ],
    query: { refetchInterval: 12_000 },
  });

  const d = reads.data;
  const val = <T,>(i: number, fallback: T): T =>
    d?.[i]?.status === "success" ? (d[i]!.result as T) : fallback;

  const shareSymbol = val<string>(0, "…");
  // The share token is named `sLP-<asset>` (older vaults use `dLP-`); show the pool, not the wrapper.
  const symbol = shareSymbol.replace(/^[A-Za-z]*LP-/, "");
  const assetToken = val<Address>(1, "0x0000000000000000000000000000000000000000");
  const usdcIsCurrency0 = val<boolean>(2, true);
  const totalSupply = val<bigint>(3, 0n);
  const prices = val<[boolean, bigint, bigint]>(4, [false, 0n, 0n]);
  const rewardRate = val<bigint>(5, 0n);
  const periodFinish = val<bigint>(6, 0n);
  const pendingCompound = val<bigint>(7, 0n);
  const pendingAssetFees = val<bigint>(8, 0n);
  const pendingProtocolFees = val<bigint>(9, 0n);
  const streamBps = Number(val<bigint | number>(10, 0));
  const protocolFeeBps = Number(val<bigint | number>(11, 0));
  const depositFeeBps = Number(val<bigint | number>(12, 0));
  const userShares = val<bigint>(13, 0n);
  const userEarned = val<bigint>(14, 0n);
  // The sentinel holder is the zero address, whose balances are real on-chain values (burn
  // address dust, and on Arc a large one). Never surface those as if they were the visitor's.
  const usdcBalance = account ? val<bigint>(15, 0n) : 0n;
  const usdcAllowance = account ? val<bigint>(16, 0n) : 0n;

  const [oracleWarm, sqrtPriceX96] = prices;

  const assetMeta = useReadContracts({
    contracts: [
      { address: assetToken, abi: erc20Abi, functionName: "decimals" },
      { address: assetToken, abi: erc20Abi, functionName: "symbol" },
      { address: assetToken, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
      { address: assetToken, abi: erc20Abi, functionName: "allowance", args: [holder, vault] },
    ],
    query: { enabled: assetToken !== "0x0000000000000000000000000000000000000000" },
  });

  const am = assetMeta.data;
  const assetDecimals = am?.[0]?.status === "success" ? Number(am[0].result) : 18;
  const assetSymbol = am?.[1]?.status === "success" ? (am[1].result as string) : symbol;
  const assetBalance = account && am?.[2]?.status === "success" ? (am[2].result as bigint) : 0n;
  const assetAllowance = account && am?.[3]?.status === "success" ? (am[3].result as bigint) : 0n;

  const totalRedeem = useReadContracts({
    contracts: [{ address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [totalSupply] }],
    query: { enabled: totalSupply > 0n, refetchInterval: 12_000 },
  });
  const userRedeem = useReadContracts({
    contracts: [{ address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [userShares] }],
    query: { enabled: userShares > 0n, refetchInterval: 12_000 },
  });

  const valueOf = (rows: typeof totalRedeem.data) => {
    const row = rows?.[0];
    if (row?.status !== "success") return { usdc: 0n, asset: 0n, total: 0n };
    const [a0, a1] = row.result as [bigint, bigint];
    const usdc = usdcIsCurrency0 ? a0 : a1;
    const asset = usdcIsCurrency0 ? a1 : a0;
    return { usdc, asset, total: usdc + tokenValueInUsdc(asset, sqrtPriceX96, usdcIsCurrency0) };
  };

  const tvl = valueOf(totalRedeem.data);
  const yours = valueOf(userRedeem.data);
  const apr = streamApr(rewardRate, tvl.total, periodFinish);

  const parse = (v: string, dec: number) => {
    try {
      return v ? parseUnits(v, dec) : 0n;
    } catch {
      return 0n;
    }
  };
  const usdcAmount = useMemo(() => parse(usdcInput, 6), [usdcInput]);
  const assetAmount = useMemo(() => parse(assetInput, assetDecimals), [assetInput, assetDecimals]);
  const withdrawShares = useMemo(() => parse(withdrawInput, 18), [withdrawInput]);

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const busy = isPending || receipt.isLoading;
  const needsUsdcApproval = usdcAmount > 0n && usdcAllowance < usdcAmount;
  const needsAssetApproval = mode === "pair" && assetAmount > 0n && assetAllowance < assetAmount;

  const approve = (token: Address) =>
    writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [vault, maxUint256] });

  const deposit = () => {
    if (mode === "usdc") {
      writeContract({
        address: vault,
        abi: vaultAbi,
        functionName: "depositUsdc",
        args: [usdcAmount, 0n, holder],
      });
      return;
    }
    const [a0, a1] = usdcIsCurrency0 ? [usdcAmount, assetAmount] : [assetAmount, usdcAmount];
    writeContract({ address: vault, abi: vaultAbi, functionName: "deposit", args: [a0, a1, 0n, holder] });
  };

  const call = (fn: string) => writeContract({ address: vault, abi: vaultAbi, functionName: fn });
  const explorer = `${targetChain.blockExplorers?.default.url ?? ""}/address/${vault}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <PairAvatar address={assetToken} symbol={symbol} />
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              {symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
            </h1>
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="mono text-xs text-[var(--color-dim)] transition-colors hover:text-[var(--color-muted)]"
            >
              {shortAddress(vault)} ↗
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge warm={oracleWarm} />
          <Link href="/pools" className="btn btn-ghost px-3 py-1.5 text-xs">
            All pools
          </Link>
        </div>
      </div>

      {!oracleWarm && (
        <div className="panel border-[var(--color-warn)] bg-[var(--color-warn-dim)] px-5 py-3.5 text-[13px] text-[var(--color-warn)]">
          The price oracle is still filling its 30-minute window. Single-sided deposits and
          compounding are paused until it does — two-sided deposits, withdrawals and claims are
          unaffected.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="TVL" value={formatUsdCompact(tvl.total)} />
        <Stat
          label="Stream APR"
          value={rewardRate > 0n ? formatPercent(apr) : "—"}
          tone={rewardRate > 0n ? "accent" : "default"}
          hint="run-rate, 7-day stream"
        />
        <Stat label="Your position" value={formatUsdCompact(yours.total)} />
        <Stat
          label="Claimable"
          value={formatUsd(userEarned)}
          tone={userEarned > 0n ? "accent" : "default"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <section className="panel-raised p-6">
          <div className="inline-flex rounded-xl bg-[var(--color-surface-3)] p-1">
            {(["usdc", "pair"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  mode === m
                    ? "bg-[var(--color-surface)] text-[var(--color-accent-deep)] shadow-[var(--shadow-sm)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {m === "usdc" ? "USDC only" : `USDC + ${assetSymbol}`}
              </button>
            ))}
          </div>

          <p className="mt-4 text-[13px] leading-relaxed text-[var(--color-muted)]">
            {mode === "usdc"
              ? "The vault swaps half your USDC into the token in one transaction, bounded by its TWAP price band. Anything the band stops it deploying is refunded."
              : "Supply both sides. Whatever the position cannot absorb at the current ratio is refunded in the same transaction."}
          </p>

          <div className="mt-5 space-y-3">
            <Field
              label="USDC"
              value={usdcInput}
              onChange={setUsdcInput}
              balance={formatAmount(usdcBalance, 6)}
              onMax={() => setUsdcInput(formatAmount(usdcBalance, 6, 6).replace(/,/g, ""))}
            />
            {mode === "pair" && (
              <Field
                label={assetSymbol}
                value={assetInput}
                onChange={setAssetInput}
                balance={formatAmount(assetBalance, assetDecimals)}
                onMax={() =>
                  setAssetInput(formatAmount(assetBalance, assetDecimals, 6).replace(/,/g, ""))
                }
              />
            )}
          </div>

          {/* A 5% cut of principal is the sort of thing a person should see before they sign, not
              afterwards on a block explorer. Shown whenever there is an amount to apply it to. */}
          {depositFeeBps > 0 && (
            <dl className="mt-5 space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <div className="flex items-baseline justify-between text-[13px]">
                <dt className="text-[var(--color-muted)]">
                  Entry fee
                  <span className="ml-1.5 num text-[var(--color-text)]">
                    {(depositFeeBps / 100).toFixed(1)}%
                  </span>
                </dt>
                <dd className="num text-[var(--color-text)]">
                  {usdcAmount > 0n
                    ? `−${formatUsd((usdcAmount * BigInt(depositFeeBps)) / 10_000n)}`
                    : "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-[var(--color-border)] pt-2 text-[13px]">
                <dt className="font-medium">Deployed into the pool</dt>
                <dd className="num font-semibold">
                  {usdcAmount > 0n
                    ? formatUsd(usdcAmount - (usdcAmount * BigInt(depositFeeBps)) / 10_000n)
                    : "—"}
                </dd>
              </div>
              <p className="pt-1 text-[11px] leading-relaxed text-[var(--color-dim)]">
                Taken from your principal, not from yield.{" "}
                <Link href="/docs/fees" className="text-[var(--color-accent)] hover:underline">
                  How fees work
                </Link>
              </p>
            </dl>
          )}

          <div className="mt-5">
            {needsUsdcApproval ? (
              <Action busy={busy} onClick={() => approve(ARC.USDC)} label="Approve USDC" />
            ) : needsAssetApproval ? (
              <Action
                busy={busy}
                onClick={() => approve(assetToken)}
                label={`Approve ${assetSymbol}`}
              />
            ) : (
              <Action
                busy={busy}
                disabled={!account || usdcAmount === 0n || (mode === "usdc" && !oracleWarm)}
                onClick={deposit}
                label={account ? "Stake" : "Connect wallet to stake"}
              />
            )}
          </div>
        </section>

        <section className="panel-raised flex flex-col p-6">
          <h2 className="text-[15px] font-semibold">Your position</h2>

          <dl className="mt-4 space-y-2.5">
            <Row label="Shares" value={formatAmount(userShares, 18, 6)} />
            <Row label="USDC backing" value={formatUsd(yours.usdc)} />
            <Row label={`${assetSymbol} backing`} value={formatAmount(yours.asset, assetDecimals)} />
            <Row label="Claimable USDC" value={formatUsd(userEarned)} accent={userEarned > 0n} />
          </dl>

          <div className="mt-5">
            <Action
              busy={busy}
              disabled={!account || userEarned === 0n}
              onClick={() => call("claim")}
              label={userEarned > 0n ? `Claim ${formatUsd(userEarned)}` : "Nothing to claim"}
              variant={userEarned > 0n ? "primary" : "ghost"}
            />
          </div>

          <div className="mt-6 border-t border-[var(--color-border)] pt-5">
            <Field
              label="Shares to withdraw"
              value={withdrawInput}
              onChange={setWithdrawInput}
              balance={formatAmount(userShares, 18, 6)}
              onMax={() => setWithdrawInput(formatAmount(userShares, 18, 18).replace(/,/g, ""))}
            />
            <div className="mt-3">
              <Action
                busy={busy}
                disabled={!account || withdrawShares === 0n || withdrawShares > userShares}
                onClick={() =>
                  writeContract({
                    address: vault,
                    abi: vaultAbi,
                    functionName: "withdraw",
                    args: [withdrawShares, 0n, 0n, holder],
                  })
                }
                label="Withdraw"
                variant="ghost"
              />
            </div>
          </div>
        </section>
      </div>

      {/* --- what the vault is made of, and where its fees go --- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel p-6">
          <h2 className="text-[15px] font-semibold">Pool composition</h2>
          <p className="mt-1.5 text-[12px] text-[var(--color-muted)]">
            A full-range position rebalances with the price, so this moves as the token does.
          </p>
          <div className="mt-5">
            <CompositionBar
              usdcValue={tvl.usdc}
              assetValue={tvl.total > tvl.usdc ? tvl.total - tvl.usdc : 0n}
              symbol={assetSymbol}
            />
          </div>
        </section>

        <section className="panel p-6">
          <h2 className="text-[15px] font-semibold">Where each harvest goes</h2>
          <p className="mt-1.5 text-[12px] text-[var(--color-muted)]">
            Set per vault, readable on-chain.
          </p>
          <div className="mt-5">
            <FeeSplitBar protocolFeeBps={protocolFeeBps} streamBps={streamBps} />
          </div>
        </section>

        <section className="panel p-6">
          <StreamRing periodFinish={periodFinish} durationSeconds={7 * 24 * 3600} />
        </section>
      </div>

      <section className="panel p-6">
        <h2 className="text-[15px] font-semibold">Keeper actions</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--color-muted)]">
          All of these are permissionless — the conditions decide validity, not the caller, and none
          of them let a caller redirect funds.
        </p>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Action busy={busy} onClick={() => call("poke")} label="Poke oracle" variant="ghost" />
          <Action busy={busy} onClick={() => call("harvest")} label="Harvest fees" variant="ghost" />
          <Action
            busy={busy}
            disabled={pendingCompound === 0n}
            onClick={() => call("compound")}
            label={`Compound ${formatUsdCompact(pendingCompound)}`}
            variant="ghost"
          />
          <Action
            busy={busy}
            disabled={pendingProtocolFees === 0n}
            onClick={() => call("collectProtocolFees")}
            label={`Pay treasury ${formatUsdCompact(pendingProtocolFees)}`}
            variant="ghost"
          />
        </div>

        <dl className="mt-6 grid gap-x-10 gap-y-3 border-t border-[var(--color-border)] pt-5 sm:grid-cols-2">
          <Row label="Queued to compound" value={formatUsd(pendingCompound)} />
          <Row
            label="Deferred token fees"
            value={formatAmount(pendingAssetFees, assetDecimals, 6)}
            hint="awaiting a price the oracle accepts"
          />
          <Row label="Stream share" value={`${(streamBps / 100).toFixed(0)}% of net fees`} />
          <Row
            label="Protocol fee accrued"
            value={formatUsd(pendingProtocolFees)}
            hint={`${(protocolFeeBps / 100).toFixed(2)}% per harvest, pulled not pushed`}
          />
        </dl>
      </section>

      {writeError && (
        <div className="panel border-[var(--color-danger)] px-5 py-4 text-[13px] text-[var(--color-danger)]">
          {writeError.message.split("\n")[0]}
        </div>
      )}
      {receipt.isSuccess && (
        <div className="panel border-[var(--color-accent)] px-5 py-4 text-[13px] text-[var(--color-accent)]">
          Transaction confirmed.
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  balance,
  onMax,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  balance: string;
  onMax: () => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label">{label}</span>
        <button
          type="button"
          onClick={onMax}
          className="num text-xs text-[var(--color-dim)] transition-colors hover:text-[var(--color-accent)]"
        >
          balance {balance}
        </button>
      </div>
      <input
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input num"
      />
    </div>
  );
}

function Action({
  label,
  onClick,
  busy,
  disabled,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`btn w-full ${variant === "primary" ? "btn-primary" : "btn-ghost"}`}
    >
      {busy ? "Pending…" : label}
    </button>
  );
}

function Row({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[13px] text-[var(--color-muted)]">
        {label}
        {hint && <span className="block text-[11px] text-[var(--color-dim)]">{hint}</span>}
      </dt>
      <dd
        className={`num shrink-0 text-[13px] ${accent ? "font-semibold text-[var(--color-up)]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
