"use client";

import Link from "next/link";
import { use, useCallback, useMemo, useState } from "react";
import type { Address } from "viem";
import { parseUnits, zeroAddress } from "viem";
import {
  useReadContracts,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWatchAsset,
  useWriteContract,
} from "wagmi";

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
import { ARC, erc20Abi, vaultAbi, onArc } from "@/lib/contracts";
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
  deviationBps,
  isDynamicFee,
  previewDepositPair,
  previewDepositUsdc,
  withSlippage,
  type PoolShape,
} from "@/lib/preview";
import { describeError, explorerAddress } from "@/lib/tx";
import { targetChain } from "@/lib/chain";

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
  "maxDeviationBps",
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
    contracts: onArc([
      ...FIELDS.map((functionName) => ({ address: vault, abi: vaultAbi, functionName })),
      { address: vault, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
      { address: vault, abi: vaultAbi, functionName: "earned", args: [holder] },
      { address: ARC.USDC, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
      { address: ARC.USDC, abi: erc20Abi, functionName: "allowance", args: [holder, vault] },
    ]),
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
  const maxDeviationBps = Number(val<bigint | number>(F.maxDeviationBps, 0));
  const sqrtLower = val<bigint>(F.sqrtPriceLowerX96, 0n);
  const sqrtUpper = val<bigint>(F.sqrtPriceUpperX96, 0n);
  const poolKey = val<PoolKey | null>(F.poolKey, null);
  const userShares = val<bigint>(I_SHARES, 0n);
  const userEarned = val<bigint>(I_EARNED, 0n);
  // The sentinel holder is the zero address, whose balances are real on-chain values (burn
  // address dust, and on Arc a large one). Never surface those as if they were the visitor's.
  const usdcBalance = account ? val<bigint>(I_USDC_BAL, 0n) : 0n;
  const usdcAllowance = account ? val<bigint>(I_USDC_ALLOW, 0n) : 0n;

  const [oracleWarm, sqrtPriceX96, twapSqrtPriceX96] = prices;

  // Warm is not the same as usable. The vault also requires spot to sit within maxDeviationBps of
  // the TWAP before it will swap, so gating only on `oracleWarm` offers a deposit that reverts and
  // charges the person gas for the privilege.
  const drift = oracleWarm ? deviationBps(sqrtPriceX96, twapSqrtPriceX96) : 0;
  const withinBand = oracleWarm && maxDeviationBps > 0 && drift <= maxDeviationBps;
  const canSwap = oracleWarm && withinBand;
  const lpFee = poolKey?.fee ?? 0;
  const hasHook = Boolean(poolKey && poolKey.hooks !== zeroAddress);

  const assetMeta = useReadContracts({
    contracts: onArc([
      { address: assetToken, abi: erc20Abi, functionName: "decimals" },
      { address: assetToken, abi: erc20Abi, functionName: "symbol" },
      { address: assetToken, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
      { address: assetToken, abi: erc20Abi, functionName: "allowance", args: [holder, vault] },
    ]),
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
    contracts: onArc([{ address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [totalSupply] }]),
    query: { enabled: totalSupply > 0n, refetchInterval: 12_000 },
  });
  const userRedeem = useReadContracts({
    contracts: onArc([{ address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [userShares] }]),
    query: { enabled: userShares > 0n, refetchInterval: 12_000 },
  });
  const withdrawRedeem = useReadContracts({
    contracts: onArc([
      { address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [withdrawShares] },
    ]),
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

  // The arithmetic above is a fallback, not a quote. It cannot see the swap's price impact and it
  // cannot see a hook's cut, and both of those make it read high — which is the dangerous
  // direction, because `minShares` is derived from it. A staker hit exactly that on ARC 101: the
  // panel offered 0.0001475 shares with a 0.5% tolerance, and the call would have returned
  // 0.0001461 — 95 bps short, so the floor rejected a deposit that was working correctly.
  //
  // So once there is an allowance to simulate against, ask the chain what the call actually
  // returns. `eth_call` runs the whole thing — entry fee, swap, hook, mint — and hands back the
  // shares. The floor is then a tolerance below a real number rather than below a hopeful one,
  // and it still does its job: the tolerance covers movement between this block and inclusion.
  const usdcApproved = Boolean(account) && usdcAllowance >= usdcAmount;
  const assetApproved = mode === "pair" ? assetAllowance >= assetAmount : true;
  const [qa0, qa1] = usdcIsCurrency0 ? [usdcAmount, assetAmount] : [assetAmount, usdcAmount];

  const quote = useSimulateContract({
    address: vault,
    abi: vaultAbi,
    functionName: mode === "usdc" ? "depositUsdc" : "deposit",
    // A zero floor here so the simulation reports what the call returns rather than whether it
    // clears a floor derived from itself.
    args: mode === "usdc" ? [usdcAmount, 0n, holder] : [qa0, qa1, 0n, holder],
    account,
    chainId: targetChain.id,
    query: {
      enabled:
        Boolean(account) &&
        !guard.wrongChain &&
        usdcAmount > 0n &&
        usdcApproved &&
        assetApproved &&
        (mode === "pair" ? assetAmount > 0n : canSwap),
      // A revert is an answer, not a transport failure worth hammering the node over.
      retry: false,
      refetchOnWindowFocus: false,
    },
  });

  const quotedShares = typeof quote.data?.result === "bigint" ? quote.data.result : undefined;

  // What the panel shows and what it insists on both come from the quote when there is one.
  const shownShares = quotedShares ?? expectedShares;
  const minShares = withSlippage(shownShares, bps);

  // A revert the simulation found is one the person would otherwise discover by paying gas for a
  // failed transaction — which is what happened here, twice, with nothing on screen to explain it.
  const quoteError = quote.error ?? null;

  // `previewRedeem` is an honest read of what the position is worth, but it is not what the
  // withdrawal returns: `withdraw` harvests on the way in, and a harvest swaps the asset-side fees
  // into USDC, which moves the very price the preview was taken at. Small, usually — and "usually"
  // is exactly the word that put a 95 bps gap into the deposit floor. Quote it instead.
  const withdrawQuote = useSimulateContract({
    address: vault,
    abi: vaultAbi,
    functionName: "withdraw",
    args: [withdrawShares, 0n, 0n, holder],
    account,
    chainId: targetChain.id,
    query: {
      enabled:
        Boolean(account) && !guard.wrongChain && withdrawShares > 0n && withdrawShares <= userShares,
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const quotedOut = Array.isArray(withdrawQuote.data?.result)
    ? (withdrawQuote.data.result as readonly [bigint, bigint])
    : undefined;

  const [previewed0, previewed1] = usdcIsCurrency0 ? [out.usdc, out.asset] : [out.asset, out.usdc];
  const [out0, out1] = quotedOut ?? [previewed0, previewed1];
  const min0 = withSlippage(out0, bps);
  const min1 = withSlippage(out1, bps);
  // Back into USDC/asset terms for display, so the panel shows what the call was quoted at
  // rather than a preview taken before the harvest that runs inside it.
  const [shownUsdcOut, shownAssetOut] = usdcIsCurrency0 ? [out0, out1] : [out1, out0];
  const [minUsdcOut, minAssetOut] = usdcIsCurrency0 ? [min0, min1] : [min1, min0];

  // "Withdraw all" sends a different size to the field above it, so it needs its own quote rather
  // than borrowing that one's. It is the exit most people take, and it should not be the one path
  // still floored by a number taken before the harvest inside the call.
  const exitQuote = useSimulateContract({
    address: vault,
    abi: vaultAbi,
    functionName: "withdraw",
    args: [userShares, 0n, 0n, holder],
    account,
    chainId: targetChain.id,
    query: {
      enabled: Boolean(account) && !guard.wrongChain && userShares > 0n,
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const quotedExit = Array.isArray(exitQuote.data?.result)
    ? (exitQuote.data.result as readonly [bigint, bigint])
    : undefined;

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
    (mode === "usdc" && !canSwap) ||
    (previewReady && shownShares === 0n) ||
    // The chain has already run this call and it reverted. Offering the button anyway is how
    // somebody ends up paying gas to be told the same thing.
    Boolean(quoteError);

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
          {/* Tracks whether the vault can actually swap, not just whether the oracle has a price.
              "Live" beside a paused deposit panel is worse than a slightly loose label. */}
          <LiveBadge warm={canSwap} />
          <Link href="/pools" className="btn btn-ghost px-3 py-1.5 text-xs">
            All pools
          </Link>
        </div>
      </div>

      {!canSwap && (
        <div className="panel border-[var(--color-warn)] bg-[var(--color-warn-dim)] px-5 py-3.5 text-[13px] text-[var(--color-warn)]">
          {!oracleWarm ? (
            <>
              The price oracle is still filling its 30-minute window, which takes about half an
              hour from when the pool was listed. Single-sided deposits and compounding wait for
              it; two-sided deposits, withdrawals and claims never consult a price and work now.
              Nothing needs doing — a keeper is feeding it.
            </>
          ) : (
            <>
              The pool price has moved{" "}
              <span className="num font-semibold">{(drift / 100).toFixed(2)}%</span> away from its
              time-weighted average, past the{" "}
              <span className="num font-semibold">{(maxDeviationBps / 100).toFixed(2)}%</span> the
              vault will swap within. Single-sided deposits and compounding are paused until it
              settles, so the vault cannot be made to trade at a dislocated price. Two-sided
              deposits, withdrawals and claims do not swap and are unaffected.
            </>
          )}
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
              none of it. The figure below is quoted from the chain once you have approved, so it
              includes the hook&apos;s cut — before then it is an estimate that does not.
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
              <dt className="text-[var(--color-muted)]">
                {quotedShares !== undefined ? "You receive" : "You receive (est.)"}
                {quotedShares !== undefined && (
                  <span className="ml-1.5 text-[11px] text-[var(--color-accent)]">quoted</span>
                )}
              </dt>
              <dd className="num text-[var(--color-text)]">
                {shownShares > 0n ? `${formatSig(shownShares, 18)} ${shareSymbol}` : "—"}
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

          {quoteError && (
            <p className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-dim)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--color-danger)]">
              This deposit would fail: {describeError(quoteError)}
            </p>
          )}

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
                  <dt>{quotedOut ? "You receive" : "You receive (est.)"}</dt>
                  <dd className="num text-[var(--color-text)]">
                    {formatUsd(shownUsdcOut)} + {formatAmount(shownAssetOut, assetDecimals, 4)}{" "}
                    {assetSymbol}
                  </dd>
                </div>
                <div className="flex justify-between text-[var(--color-muted)]">
                  <dt>Minimum you accept</dt>
                  <dd className="num text-[var(--color-text)]">
                    {formatUsd(minUsdcOut)} + {formatAmount(minAssetOut, assetDecimals, 4)}{" "}
                    {assetSymbol}
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
                  const [p0, p1] = usdcIsCurrency0 ? [u, a] : [a, u];
                  const [w0, w1] = quotedExit ?? [p0, p1];
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
            disabled={pendingCompound === 0n || !canSwap}
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
