"use client";

import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useAccount, useSwitchChain } from "wagmi";

import { targetChain } from "@/lib/chain";
import { describeError, explorerTx } from "@/lib/tx";

// --- network -----------------------------------------------------------------------------

/**
 * Whether the connected wallet can actually sign for the target chain.
 *
 * `useAccount().chainId` is the wallet's real chain, including one wagmi does not know about.
 * `useChainId()` is not: it reports the config's chain, which only ever holds a configured
 * network — so a wallet parked on Ethereum reads as "on Arc" through it, and every action goes
 * to the wrong chain. Any button that sends a transaction should consult this, not that.
 */
export function useNetworkGuard() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const wrongChain = isConnected && chainId !== targetChain.id;
  return {
    account: address,
    wrongChain,
    switching: isPending,
    switchToTarget: () => switchChain({ chainId: targetChain.id }),
  };
}

// --- slippage ----------------------------------------------------------------------------

const SLIPPAGE_KEY = "slice:slippage-bps";
export const DEFAULT_SLIPPAGE_BPS = 50;

/** Slippage tolerance in bps, remembered per browser. Storage may be unavailable; never assume it. */
export function useSlippage() {
  const [bps, setBpsState] = useState(DEFAULT_SLIPPAGE_BPS);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(SLIPPAGE_KEY));
      if (Number.isInteger(saved) && saved > 0 && saved <= 5_000) setBpsState(saved);
    } catch {
      /* private mode, blocked storage — the default stands */
    }
  }, []);

  const setBps = (next: number) => {
    setBpsState(next);
    try {
      localStorage.setItem(SLIPPAGE_KEY, String(next));
    } catch {
      /* same */
    }
  };

  return { bps, setBps };
}

const PRESETS = [10, 50, 100, 300];

export function SlippageControl({ bps, setBps }: { bps: number; setBps: (n: number) => void }) {
  const [custom, setCustom] = useState("");
  const isPreset = PRESETS.includes(bps);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="label">Slippage</span>
      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => {
            setBps(p);
            setCustom("");
          }}
          className={`num rounded-md px-2 py-1 text-[12px] transition-colors ${
            bps === p
              ? "bg-[var(--color-accent-dim)] text-[var(--color-accent-deep)]"
              : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
          }`}
        >
          {p / 100}%
        </button>
      ))}
      <span className="relative">
        <input
          inputMode="decimal"
          placeholder="custom"
          value={custom || (isPreset ? "" : String(bps / 100))}
          onChange={(e) => {
            setCustom(e.target.value);
            const pct = Number(e.target.value);
            if (Number.isFinite(pct) && pct > 0 && pct <= 50) setBps(Math.round(pct * 100));
          }}
          style={{ width: "5.5rem" }}
          className="input num px-2 py-1 text-[12px]"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[var(--color-dim)]">
          %
        </span>
      </span>
      {bps >= 300 && (
        <span className="text-[11px] text-[var(--color-warn)]">
          High tolerance — you accept up to {bps / 100}% less than quoted.
        </span>
      )}
    </div>
  );
}

// --- transaction lifecycle ---------------------------------------------------------------

/**
 * Run `onConfirmed` once per confirmed transaction.
 *
 * A confirmed receipt stays `isSuccess` for as long as the hook holds that hash, so an effect
 * keyed on it alone would fire on every render. Remembering the last hash handled makes it fire
 * exactly once per transaction, which is what "refresh the numbers after this lands" needs.
 */
export function useAfterConfirm(hash: Hex | undefined, isSuccess: boolean, onConfirmed: () => void) {
  const handled = useRef<Hex | undefined>(undefined);
  useEffect(() => {
    if (!hash || !isSuccess || handled.current === hash) return;
    handled.current = hash;
    onConfirmed();
  }, [hash, isSuccess, onConfirmed]);
}

export function TxStatus({
  hash,
  isPending,
  isConfirming,
  isSuccess,
  error,
  successLabel = "Confirmed.",
}: {
  hash?: Hex;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error: unknown;
  successLabel?: string;
}) {
  if (error) {
    return (
      <div className="panel border-[var(--color-danger)] px-5 py-4 text-[13px] text-[var(--color-danger)]">
        {describeError(error)}
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="panel px-5 py-4 text-[13px] text-[var(--color-muted)]">
        Waiting for your wallet…
      </div>
    );
  }
  if (isConfirming && hash) {
    return (
      <div className="panel px-5 py-4 text-[13px] text-[var(--color-muted)]">
        Submitted — waiting for Arc to include it.{" "}
        <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="underline">
          View on explorer ↗
        </a>
      </div>
    );
  }
  if (isSuccess && hash) {
    return (
      <div className="panel border-[var(--color-accent)] px-5 py-4 text-[13px] text-[var(--color-accent)]">
        {successLabel}{" "}
        <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="underline">
          View on explorer ↗
        </a>
      </div>
    );
  }
  return null;
}

/**
 * A transaction button that knows about the network.
 *
 * On the wrong chain it becomes the switch button, because a disabled "Stake" with no
 * explanation and a working "Stake" that sends to the wrong network are both worse than that.
 */
export function Action({
  label,
  onClick,
  busy,
  disabled,
  variant = "primary",
  guard,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  guard?: ReturnType<typeof useNetworkGuard>;
}) {
  if (guard?.wrongChain) {
    return (
      <button
        type="button"
        onClick={guard.switchToTarget}
        disabled={guard.switching}
        className="btn w-full border border-[var(--color-warn)] bg-[var(--color-warn-dim)] text-[var(--color-warn)]"
      >
        {guard.switching ? "Switching…" : `Switch to ${targetChain.name}`}
      </button>
    );
  }
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
