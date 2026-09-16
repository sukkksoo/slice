"use client";

import { use, useMemo, useState } from "react";
import type { Address } from "viem";
import { maxUint256, parseUnits } from "viem";
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { Stat } from "@/components/Stat";
import { ARC, erc20Abi, vaultAbi } from "@/lib/contracts";
import { formatAmount, formatPercent, formatUsd, formatUsdCompact, shortAddress } from "@/lib/format";
import { streamApr, tokenValueInUsdc } from "@/lib/format";

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
      { address: vault, abi: vaultAbi, functionName: "streamBps" },
      { address: vault, abi: vaultAbi, functionName: "protocolFeeBps" },
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

  const symbol = val<string>(0, "…");
  const assetToken = val<Address>(1, "0x0000000000000000000000000000000000000000");
  const usdcIsCurrency0 = val<boolean>(2, true);
  const totalSupply = val<bigint>(3, 0n);
  const prices = val<[boolean, bigint, bigint]>(4, [false, 0n, 0n]);
  const rewardRate = val<bigint>(5, 0n);
  const periodFinish = val<bigint>(6, 0n);
  const pendingCompound = val<bigint>(7, 0n);
  const pendingAssetFees = val<bigint>(8, 0n);
  const streamBps = Number(val<bigint | number>(9, 0));
  const protocolFeeBps = Number(val<bigint | number>(10, 0));
  const userShares = val<bigint>(11, 0n);
  const userEarned = val<bigint>(12, 0n);
  const usdcBalance = val<bigint>(13, 0n);
  const usdcAllowance = val<bigint>(14, 0n);

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
  const assetBalance = am?.[2]?.status === "success" ? (am[2].result as bigint) : 0n;
  const assetAllowance = am?.[3]?.status === "success" ? (am[3].result as bigint) : 0n;

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

  const usdcAmount = useMemo(() => {
    try {
      return usdcInput ? parseUnits(usdcInput, 6) : 0n;
    } catch {
      return 0n;
    }
  }, [usdcInput]);

  const assetAmount = useMemo(() => {
    try {
      return assetInput ? parseUnits(assetInput, assetDecimals) : 0n;
    } catch {
      return 0n;
    }
  }, [assetInput, assetDecimals]);

  const withdrawShares = useMemo(() => {
    try {
      return withdrawInput ? parseUnits(withdrawInput, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [withdrawInput]);

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

  const explorer = `https://explorer.arc.io/address/${vault}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {symbol} <span className="text-[var(--color-muted)]">/ USDC</span>
          </h1>
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            {shortAddress(vault)} ↗
          </a>
        </div>
        {!oracleWarm && (
          <div className="rounded border border-[var(--color-warn)] px-3 py-1.5 text-[11px] text-[var(--color-warn)]">
            Oracle warming — single-sided deposits are paused
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="TVL" value={formatUsdCompact(tvl.total)} />
        <Stat
          label="Stream APR"
          value={rewardRate > 0n ? formatPercent(apr) : "—"}
          tone={rewardRate > 0n ? "accent" : "default"}
          hint="run-rate, 7-day stream"
        />
        <Stat label="Your position" value={formatUsdCompact(yours.total)} />
        <Stat label="Claimable" value={formatUsd(userEarned)} tone={userEarned > 0n ? "accent" : "default"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* --- stake --- */}
        <section className="panel space-y-4 p-5">
          <div className="flex items-center gap-1">
            {(["usdc", "pair"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded px-3 py-1.5 text-xs ${
                  mode === m
                    ? "bg-[var(--color-panel-2)] text-[var(--color-text)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {m === "usdc" ? "USDC only" : `USDC + ${assetSymbol}`}
              </button>
            ))}
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
            {mode === "usdc"
              ? "The vault swaps half your USDC into the token inside one transaction, bounded by its TWAP price band. Anything the band stops it from deploying is refunded."
              : "Supply both sides. Whatever the position cannot absorb at the current ratio is refunded in the same transaction."}
          </p>

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
              onMax={() => setAssetInput(formatAmount(assetBalance, assetDecimals, 6).replace(/,/g, ""))}
            />
          )}

          {needsUsdcApproval ? (
            <Action busy={busy} onClick={() => approve(ARC.USDC)} label="Approve USDC" />
          ) : needsAssetApproval ? (
            <Action busy={busy} onClick={() => approve(assetToken)} label={`Approve ${assetSymbol}`} />
          ) : (
            <Action
              busy={busy}
              disabled={!account || usdcAmount === 0n || (mode === "usdc" && !oracleWarm)}
              onClick={deposit}
              label={account ? "Stake" : "Connect wallet"}
            />
          )}
        </section>

        {/* --- position --- */}
        <section className="panel space-y-4 p-5">
          <div className="text-xs font-semibold">Your position</div>

          <dl className="space-y-1.5 text-[11px]">
            <Row label="Shares" value={formatAmount(userShares, 18, 6)} />
            <Row label="USDC backing" value={formatUsd(yours.usdc)} />
            <Row label={`${assetSymbol} backing`} value={formatAmount(yours.asset, assetDecimals)} />
            <Row label="Claimable USDC" value={formatUsd(userEarned)} accent={userEarned > 0n} />
          </dl>

          <Action
            busy={busy}
            disabled={!account || userEarned === 0n}
            onClick={() => writeContract({ address: vault, abi: vaultAbi, functionName: "claim" })}
            label="Claim USDC"
            variant="secondary"
          />

          <div className="border-t border-[var(--color-border)] pt-4">
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
                variant="secondary"
              />
            </div>
          </div>
        </section>
      </div>

      {/* --- keeper --- */}
      <section className="panel space-y-3 p-5">
        <div className="text-xs font-semibold">Keeper actions</div>
        <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
          All three are permissionless. <span className="text-[var(--color-text)]">Poke</span> records
          a price observation and is what keeps the TWAP window alive;{" "}
          <span className="text-[var(--color-text)]">harvest</span> collects fees and starts the
          stream; <span className="text-[var(--color-text)]">compound</span> turns the queued USDC
          into more liquidity, which raises every share&apos;s backing without minting new shares.
        </p>

        <div className="grid gap-2 sm:grid-cols-3">
          <Action busy={busy} onClick={() => writeContract({ address: vault, abi: vaultAbi, functionName: "poke" })} label="Poke oracle" variant="secondary" />
          <Action busy={busy} onClick={() => writeContract({ address: vault, abi: vaultAbi, functionName: "harvest" })} label="Harvest" variant="secondary" />
          <Action
            busy={busy}
            disabled={pendingCompound === 0n}
            onClick={() => writeContract({ address: vault, abi: vaultAbi, functionName: "compound" })}
            label={`Compound ${formatUsdCompact(pendingCompound)}`}
            variant="secondary"
          />
        </div>

        <dl className="space-y-1.5 border-t border-[var(--color-border)] pt-3 text-[11px]">
          <Row label="Queued to compound" value={formatUsd(pendingCompound)} />
          <Row
            label="Deferred token fees"
            value={formatAmount(pendingAssetFees, assetDecimals, 6)}
            hint="awaiting a price the oracle will accept"
          />
          <Row label="Stream share" value={`${(streamBps / 100).toFixed(0)}% of net fees`} />
          <Row label="Protocol fee" value={`${(protocolFeeBps / 100).toFixed(2)}% of harvest`} />
        </dl>
      </section>

      {writeError && (
        <div className="panel border-[var(--color-danger)] px-4 py-3 text-[11px] text-[var(--color-danger)]">
          {writeError.message.split("\n")[0]}
        </div>
      )}
      {receipt.isSuccess && (
        <div className="panel border-[var(--color-accent)] px-4 py-3 text-[11px] text-[var(--color-accent)]">
          Confirmed.
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
      <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
        <span>{label}</span>
        <button type="button" onClick={onMax} className="hover:text-[var(--color-text)]">
          balance {balance}
        </button>
      </div>
      <input
        inputMode="decimal"
        placeholder="0.0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="num w-full rounded border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
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
  variant?: "primary" | "secondary";
}) {
  const base = "w-full rounded px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-40";
  const style =
    variant === "primary"
      ? "bg-[var(--color-accent)] text-black"
      : "border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)]";

  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={`${base} ${style}`}>
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
      <dt className="text-[var(--color-muted)]">
        {label}
        {hint && <span className="ml-1 opacity-70">({hint})</span>}
      </dt>
      <dd className={`num ${accent ? "text-[var(--color-accent)]" : ""}`}>{value}</dd>
    </div>
  );
}
