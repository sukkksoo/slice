"use client";

import Link from "next/link";
import { use, useCallback, useMemo, useState } from "react";
import type { Address } from "viem";
import { parseUnits, zeroAddress } from "viem";
import { useReadContracts, useWaitForTransactionReceipt, useWatchAsset, useWriteContract } from "wagmi";

import {
  Action,
  SlippageControl,
  TxStatus,
  useAfterConfirm,
  useNetworkGuard,
  useSlippage,
} from "@/components/tx";
import { LiveBadge, PairAvatar, Stat } from "@/components/ui";
import { CompositionBar, FeeSplitBar, StreamRing } from "@/components/viz";
import { ARC, erc20Abi, vaultAbi } from "@/lib/contracts";
import {
  formatAmount,
  formatPercent,
  formatSig,
  formatUsd,
  formatUsdCompact,
  shortAddress,
  streamApr,
  tokenValueInUsdc,
} from "@/lib/format";
import {
  isDynamicFee,
  previewDepositPair,
  previewDepositUsdc,
  withSlippage,
  type PoolShape,
} from "@/lib/preview";
import { explorerAddress } from "@/lib/tx";

type Mode = "usdc" | "pair";
type LastAction = "approve" | "deposit" | "withdraw" | "claim" | "keeper";

type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

/** Vault reads in a fixed order, so the decoder below can be positional without magic numbers. */
const FIELDS = [
  "symbol",
  "assetCurrency",
  "usdcIsCurrency0",
  "totalSupply",
  "totalLiquidity",
  "prices",
  "rewardRate",
  "periodFinish",
  "pendingCompound",
  "pendingAssetFees",
  "pendingProtocolFees",
  "streamBps",
  "protocolFeeBps",
  "depositFeeBps",
  "sqrtPriceLowerX96",
  "sqrtPriceUpperX96",
  "poolKey",
] as const;
type Field = (typeof FIELDS)[number];
const F = Object.fromEntries(FIELDS.map((f, i) => [f, i])) as Record<Field, number>;
// Holder-specific reads follow the fixed fields.
const I_SHARES = FIELDS.length;
const I_EARNED = FIELDS.length + 1;
const I_USDC_BAL = FIELDS.length + 2;
const I_USDC_ALLOW = FIELDS.length + 3;

export default function VaultPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: routeAddress } = use(params);
  const vault = routeAddress as Address;

  const guard = useNetworkGuard();
  const account = guard.account;
  const holder = account ?? zeroAddress;

  const [mode, setMode] = useState<Mode>("usdc");
  const [usdcInput, setUsdcInput] = useState("");
  const [assetInput, setAssetInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [lastAction, setLastAction] = useState<LastAction>("keeper");
  const { bps, setBps } = useSlippage();

  const reads = useReadContracts({
    contracts: [
      ...FIELDS.map((functionName) => ({ address: vault, abi: vaultAbi, functionName })),
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

  const shareSymbol = val<string>(F.symbol, "…");
  // The share token is named `sLP-<asset>` (older vaults use `dLP-`); show the pool, not the wrapper.
  const symbol = shareSymbol.replace(/^[A-Za-z]*LP-/, "");
  const assetToken = val<Address>(F.assetCurrency, zeroAddress);
  const usdcIsCurrency0 = val<boolean>(F.usdcIsCurrency0, true);
  const totalSupply = val<bigint>(F.totalSupply, 0n);
  const totalLiquidity = val<bigint>(F.totalLiquidity, 0n);
  const prices = val<[boolean, bigint, bigint]>(F.prices, [false, 0n, 0n]);
  const rewardRate = val<bigint>(F.rewardRate, 0n);
  const periodFinish = val<bigint>(F.periodFinish, 0n);
  const pendingCompound = val<bigint>(F.pendingCompound, 0n);
  const pendingAssetFees = val<bigint>(F.pendingAssetFees, 0n);
  const pendingProtocolFees = val<bigint>(F.pendingProtocolFees, 0n);
  const streamBps = Number(val<bigint | number>(F.streamBps, 0));
  const protocolFeeBps = Number(val<bigint | number>(F.protocolFeeBps, 0));
  const depositFeeBps = Number(val<bigint | number>(F.depositFeeBps, 0));
  const sqrtLower = val<bigint>(F.sqrtPriceLowerX96, 0n);
  const sqrtUpper = val<bigint>(F.sqrtPriceUpperX96, 0n);
  const poolKey = val<PoolKey | null>(F.poolKey, null);
  const userShares = val<bigint>(I_SHARES, 0n);
  const userEarned = val<bigint>(I_EARNED, 0n);
  // The sentinel holder is the zero address, whose balances are real on-chain values (burn
  // address dust, and on Arc a large one). Never surface those as if they were the visitor's.
  const usdcBalance = account ? val<bigint>(I_USDC_BAL, 0n) : 0n;
  const usdcAllowance = account ? val<bigint>(I_USDC_ALLOW, 0n) : 0n;

  const [oracleWarm, sqrtPriceX96] = prices;
  const lpFee = poolKey?.fee ?? 0;
  const hasHook = Boolean(poolKey && poolKey.hooks !== zeroAddress);

  const assetMeta = useReadContracts({
    contracts: [
      { address: assetToken, abi: erc20Abi, functionName: "decimals" },
      { address: assetToken, abi: erc20Abi, functionName: "symbol" },
      { address: assetToken, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
      { address: assetToken, abi: erc20Abi, functionName: "allowance", args: [holder, vault] },
    ],
    query: { enabled: assetToken !== zeroAddress, refetchInterval: 12_000 },
  });

  const am = assetMeta.data;
  const assetDecimals = am?.[0]?.status === "success" ? Number(am[0].result) : 18;
  const assetSymbol = am?.[1]?.status === "success" ? (am[1].result as string) : symbol;
  const assetBalance = account && am?.[2]?.status === "success" ? (am[2].result as bigint) : 0n;
  const assetAllowance = account && am?.[3]?.status === "success" ? (am[3].result as bigint) : 0n;

  const parse = (v: string, dec: number) => {
    try {
      return v ? parseUnits(v.replace(/,/g, ""), dec) : 0n;
    } catch {
      return 0n;
    }
  };
  const usdcAmount = useMemo(() => parse(usdcInput, 6), [usdcInput]);
  const assetAmount = useMemo(() => parse(assetInput, assetDecimals), [assetInput, assetDecimals]);
  const withdrawShares = useMemo(() => parse(withdrawInput, 18), [withdrawInput]);

  const totalRedeem = useReadContracts({
    contracts: [{ address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [totalSupply] }],
    query: { enabled: totalSupply > 0n, refetchInterval: 12_000 },
  });
  const userRedeem = useReadContracts({
    contracts: [{ address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [userShares] }],
    query: { enabled: userShares > 0n, refetchInterval: 12_000 },
  });
  const withdrawRedeem = useReadContracts({
    contracts: [
      { address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [withdrawShares] },
    ],
    query: { enabled: withdrawShares > 0n && withdrawShares <= userShares },
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
  const out = valueOf(withdrawRedeem.data);
  const apr = streamApr(rewardRate, tvl.total, periodFinish);

  // --- what this deposit or withdrawal is expected to return, and the floor we will insist on ---

  const pool: PoolShape = {
    sqrtP: sqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    usdcIsCurrency0,
    totalSupply,
    totalLiquidity,
    depositFeeBps,
  };
  const previewReady = sqrtPriceX96 > 0n && sqrtLower > 0n && sqrtUpper > 0n;

  const expectedShares = useMemo(() => {
    if (!previewReady || usdcAmount === 0n) return 0n;
    if (mode === "pair") {
      return assetAmount === 0n ? 0n : previewDepositPair(usdcAmount, assetAmount, pool);
    }
    return previewDepositUsdc(usdcAmount, lpFee, pool);
    // pool is rebuilt each render from these primitives; listing them keeps the memo honest.
  }, [
    previewReady,
    usdcAmount,
    assetAmount,
    mode,
    lpFee,
    sqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    usdcIsCurrency0,
    totalSupply,
    totalLiquidity,
    depositFeeBps,
  ]);
  const minShares = withSlippage(expectedShares, bps);

  const [out0, out1] = usdcIsCurrency0 ? [out.usdc, out.asset] : [out.asset, out.usdc];
  const min0 = withSlippage(out0, bps);
  const min1 = withSlippage(out1, bps);

  const shareOfPool = totalSupply > 0n ? Number((userShares * 1_000_000n) / totalSupply) / 10_000 : 0;
  const streamActive = periodFinish * 1000n > BigInt(Date.now());
  const dailyEarnings =
    streamActive && totalSupply > 0n
      ? (((rewardRate * 86_400n) / 10n ** 18n) * userShares) / totalSupply
      : 0n;

  // --- transactions ---

  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || receipt.isLoading;
  const { watchAsset } = useWatchAsset();

  const refresh = useCallback(() => {
    void reads.refetch();
    void assetMeta.refetch();
    void totalRedeem.refetch();
    void userRedeem.refetch();
    // An approval confirming should not wipe what the person typed — they are about to use it.
    if (lastAction === "deposit") {
      setUsdcInput("");
      setAssetInput("");
    }
    if (lastAction === "withdraw") setWithdrawInput("");
  }, [reads, assetMeta, totalRedeem, userRedeem, lastAction]);
  useAfterConfirm(txHash, receipt.isSuccess, refresh);

  const send = (action: LastAction, fn: () => void) => {
    reset();
    setLastAction(action);
    fn();
  };

  // Approve exactly what this deposit pulls. The vault takes maximums and refunds the rest, so
  // the amount typed is the most it can ever move — an unlimited approval buys nothing except
  // exposure to any bug in an unaudited contract.
  // Only a connected wallet can be short of allowance; disconnected, the button's job is to say so.
  const needsUsdcApproval = Boolean(account) && usdcAmount > 0n && usdcAllowance < usdcAmount;
  const needsAssetApproval =
    Boolean(account) && mode === "pair" && assetAmount > 0n && assetAllowance < assetAmount;

  const approve = (token: Address, amount: bigint) =>
    send("approve", () =>
      writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [vault, amount] }),
    );

  const deposit = () =>
    send("deposit", () => {
      if (mode === "usdc") {
        writeContract({
          address: vault,
          abi: vaultAbi,
          functionName: "depositUsdc",
          args: [usdcAmount, minShares, holder],
        });
        return;
      }
      const [a0, a1] = usdcIsCurrency0 ? [usdcAmount, assetAmount] : [assetAmount, usdcAmount];
      writeContract({
        address: vault,
        abi: vaultAbi,
        functionName: "deposit",
        args: [a0, a1, minShares, holder],
      });
    });

  const withdraw = (shares: bigint, m0: bigint, m1: bigint) =>
    send("withdraw", () =>
      writeContract({
        address: vault,
        abi: vaultAbi,
        functionName: "withdraw",
        args: [shares, m0, m1, holder],
      }),
    );

  const call = (action: LastAction, fn: string) =>
    send(action, () => writeContract({ address: vault, abi: vaultAbi, functionName: fn }));

  const depositDisabled =
    !account ||
    usdcAmount === 0n ||
    (mode === "pair" && assetAmount === 0n) ||
    (mode === "usdc" && !oracleWarm) ||
    (previewReady && expectedShares === 0n);

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
              href={explorerAddress(vault)}
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
              : "Supply both sides. Whatever the position cannot absorb at the current ratio is refunded in the same transaction — and the entry fee on the refunded part comes back with it."}
          </p>

          {mode === "usdc" && hasHook && (
            <p className="mt-3 rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-dim)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--color-warn)]">
              This pool has a hook, and launchpad hooks usually tax swaps. A USDC-only deposit
              swaps half the input and pays that tax; supplying both sides does not swap and pays
              none of it. The estimate below does not include the hook&apos;s cut, so a tight
              slippage setting may revert here — that is the floor doing its job.
            </p>
          )}

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

          {/* A cut of principal is the sort of thing a person should see before they sign, not
              afterwards on a block explorer. Shown whenever there is an amount to apply it to. */}
          <dl className="mt-5 space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
            {depositFeeBps > 0 && (
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
            )}
            <div className="flex items-baseline justify-between text-[13px]">
              <dt className="text-[var(--color-muted)]">You receive (est.)</dt>
              <dd className="num text-[var(--color-text)]">
                {expectedShares > 0n ? `${formatSig(expectedShares, 18)} ${shareSymbol}` : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-[var(--color-border)] pt-2 text-[13px]">
              <dt className="font-medium">Minimum you accept</dt>
              <dd className="num font-semibold">
                {minShares > 0n ? `${formatSig(minShares, 18)} ${shareSymbol}` : "—"}
              </dd>
            </div>
            <p className="pt-1 text-[11px] leading-relaxed text-[var(--color-dim)]">
              The minimum is written into the transaction. If the pool moves so you would get less,
              it reverts and nothing is taken.{" "}
              <Link href="/docs/fees" className="text-[var(--color-accent)] hover:underline">
                How fees work
              </Link>
              {lpFee > 0 && !isDynamicFee(lpFee) && (
                <> · Pool fee {(lpFee / 10_000).toFixed(2)}%, earned by stakers.</>
              )}
            </p>
          </dl>

          <div className="mt-4">
            <SlippageControl bps={bps} setBps={setBps} />
          </div>

          <div className="mt-5">
            {needsUsdcApproval ? (
              <Action
                guard={guard}
                busy={busy}
                onClick={() => approve(ARC.USDC, usdcAmount)}
                label={`Approve ${formatUsd(usdcAmount)}`}
              />
            ) : needsAssetApproval ? (
              <Action
                guard={guard}
                busy={busy}
                onClick={() => approve(assetToken, assetAmount)}
                label={`Approve ${formatAmount(assetAmount, assetDecimals, 4)} ${assetSymbol}`}
              />
            ) : (
              <Action
                guard={guard}
                busy={busy}
                disabled={depositDisabled}
                onClick={deposit}
                label={account ? "Stake" : "Connect wallet to stake"}
              />
            )}
          </div>
        </section>

        <section className="panel-raised flex flex-col p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Your position</h2>
            {account && (
              <button
                type="button"
                onClick={() =>
                  watchAsset({
                    type: "ERC20",
                    options: { address: vault, symbol: shareSymbol.slice(0, 11), decimals: 18 },
                  })
                }
                className="text-[11px] text-[var(--color-dim)] transition-colors hover:text-[var(--color-accent)]"
              >
                Add {shareSymbol} to wallet
              </button>
            )}
          </div>

          <dl className="mt-4 space-y-2.5">
            <Row label="Shares" value={formatSig(userShares, 18, 6)} />
            <Row
              label="Share of pool"
              value={userShares > 0n ? `${shareOfPool.toFixed(shareOfPool < 0.01 ? 4 : 2)}%` : "—"}
            />
            <Row label="USDC backing" value={formatUsd(yours.usdc)} />
            <Row label={`${assetSymbol} backing`} value={formatAmount(yours.asset, assetDecimals)} />
            <Row
              label="Earning now"
              value={dailyEarnings > 0n ? `${formatUsd(dailyEarnings)} / day` : "—"}
              hint={streamActive ? "at the current stream rate" : "no stream running"}
            />
            <Row label="Claimable USDC" value={formatUsd(userEarned)} accent={userEarned > 0n} />
          </dl>

          <div className="mt-5">
            <Action
              guard={guard}
              busy={busy}
              disabled={!account || userEarned === 0n}
              onClick={() => call("claim", "claim")}
              label={userEarned > 0n ? `Claim ${formatUsd(userEarned)}` : "Nothing to claim"}
              variant={userEarned > 0n ? "primary" : "ghost"}
            />
          </div>

          <div className="mt-6 border-t border-[var(--color-border)] pt-5">
            <Field
              label="Shares to withdraw"
              value={withdrawInput}
              onChange={setWithdrawInput}
              balance={formatSig(userShares, 18, 6)}
              onMax={() => setWithdrawInput(formatAmount(userShares, 18, 18).replace(/,/g, ""))}
            />
            {withdrawShares > 0n && withdrawShares <= userShares && (
              <dl className="mt-3 space-y-1.5 text-[12px]">
                <div className="flex justify-between text-[var(--color-muted)]">
                  <dt>You receive (est.)</dt>
                  <dd className="num text-[var(--color-text)]">
                    {formatUsd(out.usdc)} + {formatAmount(out.asset, assetDecimals, 4)} {assetSymbol}
                  </dd>
                </div>
                <div className="flex justify-between text-[var(--color-muted)]">
                  <dt>Minimum you accept</dt>
                  <dd className="num text-[var(--color-text)]">
                    {formatUsd(withSlippage(out.usdc, bps))} +{" "}
                    {formatAmount(withSlippage(out.asset, bps), assetDecimals, 4)} {assetSymbol}
                  </dd>
                </div>
              </dl>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Action
                guard={guard}
                busy={busy}
                disabled={!account || withdrawShares === 0n || withdrawShares > userShares}
                onClick={() => withdraw(withdrawShares, min0, min1)}
                label="Withdraw"
                variant="ghost"
              />
              <Action
                guard={guard}
                busy={busy}
                disabled={!account || userShares === 0n}
                onClick={() => {
                  // Exact share balance, not a string round-trip — so "all" means all.
                  const [u, a] = [yours.usdc, yours.asset];
                  const [w0, w1] = usdcIsCurrency0 ? [u, a] : [a, u];
                  withdraw(userShares, withSlippage(w0, bps), withSlippage(w1, bps));
                }}
                label="Withdraw all"
                variant="ghost"
              />
            </div>
          </div>
        </section>
      </div>

      <TxStatus
        hash={txHash}
        isPending={isPending}
        isConfirming={receipt.isLoading}
        isSuccess={receipt.isSuccess}
        error={writeError}
        successLabel="Confirmed — the figures above have been refreshed."
      />

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
          <Action guard={guard} busy={busy} onClick={() => call("keeper", "poke")} label="Poke oracle" variant="ghost" />
          <Action guard={guard} busy={busy} onClick={() => call("keeper", "harvest")} label="Harvest fees" variant="ghost" />
          <Action
            guard={guard}
            busy={busy}
            disabled={pendingCompound === 0n || !oracleWarm}
            onClick={() => call("keeper", "compound")}
            label={`Compound ${formatUsdCompact(pendingCompound)}`}
            variant="ghost"
          />
          <Action
            guard={guard}
            busy={busy}
            disabled={pendingProtocolFees === 0n}
            onClick={() => call("keeper", "collectProtocolFees")}
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
