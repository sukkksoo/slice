"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { formatUsd, formatUsdCompact } from "@/lib/format";

/**
 * The path a single trade takes to become a staker's USDC, drawn to scale.
 *
 * The figures are a worked example rather than live data — a landing page has to explain the
 * mechanism before a visitor has any position to look at, and an empty vault shows zeroes. Every
 * proportion here is the protocol's real arithmetic: the pool fee comes off the trade, the
 * protocol takes its cut of that fee and nothing else, and what remains is split by `streamBps`.
 */
export function FeeWaterfall({
  volumeUsd = 50_000,
  poolFeeBps = 100,
  protocolFeeBps = 1_000,
  streamBps = 10_000,
}: {
  volumeUsd?: number;
  poolFeeBps?: number;
  protocolFeeBps?: number;
  streamBps?: number;
}) {
  const fees = (volumeUsd * poolFeeBps) / 10_000;
  const protocol = (fees * protocolFeeBps) / 10_000;
  const distributable = fees - protocol;
  const streamed = (distributable * streamBps) / 10_000;
  const compounded = distributable - streamed;

  const rows = [
    {
      label: "Daily trading volume",
      value: volumeUsd,
      of: volumeUsd,
      tone: "muted" as const,
      note: "What the pool turns over in a day",
    },
    {
      label: `Pool fee — ${(poolFeeBps / 100).toFixed(2)}%`,
      value: fees,
      of: volumeUsd,
      tone: "accent" as const,
      note: "Paid by traders to liquidity providers. This is the whole source of yield.",
    },
    {
      label: `Protocol fee — ${(protocolFeeBps / 100).toFixed(0)}% of that`,
      value: protocol,
      of: volumeUsd,
      tone: "dim" as const,
      note: "Slice's only recurring charge, and it is a share of yield, never of your deposit.",
    },
    {
      label: "Streamed to stakers",
      value: streamed,
      of: volumeUsd,
      tone: "up" as const,
      note: "Paid out linearly over seven days, accruing every second.",
    },
  ];
  if (compounded > 0) {
    rows.push({
      label: "Compounded into liquidity",
      value: compounded,
      of: volumeUsd,
      tone: "accent" as const,
      note: "Added back to the position, raising what every share is worth.",
    });
  }

  const colour = {
    muted: "var(--color-dim)",
    accent: "var(--color-accent)",
    dim: "var(--color-dim)",
    up: "var(--color-up)",
  };

  return (
    <div className="space-y-3.5">
      {rows.map((r) => {
        // Square-root the width so a 1% slice is still legible next to the 100% bar it came from.
        // A linear scale renders the fee as a one-pixel sliver and explains nothing.
        const pct = Math.max(0.6, Math.sqrt(r.value / r.of) * 100);
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[13px] font-medium">{r.label}</span>
              <span className="num shrink-0 text-[13px] font-semibold">
                {formatUsd(BigInt(Math.round(r.value * 1e6)))}
                <span className="ml-1 text-[11px] font-normal text-[var(--color-dim)]">/ day</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${pct}%`, background: colour[r.tone] }}
              />
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-muted)]">{r.note}</p>
          </div>
        );
      })}
      <p className="border-t border-[var(--color-border)] pt-3 text-[11px] leading-relaxed text-[var(--color-dim)]">
        Bars are square-root scaled so the small slices stay readable — a 1% fee drawn linearly
        against its own volume is a single pixel.
      </p>
    </div>
  );
}

/**
 * What a deposit would earn, at a volume the visitor picks.
 *
 * Deliberately framed as arithmetic rather than a forecast. A pool's fee income is whatever it
 * trades multiplied by its fee, so the honest thing to show is that multiplication with the inputs
 * exposed, not an APR lifted from a good week and extrapolated.
 */
export function YieldCalculator() {
  const [deposit, setDeposit] = useState(1_000);
  const [volume, setVolume] = useState(50_000);
  const [tvl, setTvl] = useState(250_000);
  const poolFeeBps = 100;
  const protocolFeeBps = 1_000;

  const { daily, yearly, apr, share } = useMemo(() => {
    const share = tvl > 0 ? deposit / tvl : 0;
    const poolFees = (volume * poolFeeBps) / 10_000;
    const afterProtocol = poolFees * (1 - protocolFeeBps / 10_000);
    const daily = afterProtocol * share;
    const yearly = daily * 365;
    return { daily, yearly, apr: deposit > 0 ? (yearly / deposit) * 100 : 0, share };
  }, [deposit, volume, tvl]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        <Slider
          label="Your deposit"
          value={deposit}
          min={100}
          max={100_000}
          step={100}
          onChange={setDeposit}
          format={(v) => `$${v.toLocaleString()}`}
        />
        <Slider
          label="Pool's daily volume"
          value={volume}
          min={1_000}
          max={2_000_000}
          step={1_000}
          onChange={setVolume}
          format={(v) => `$${v.toLocaleString()}`}
        />
        <Slider
          label="Total staked in the vault"
          value={tvl}
          min={10_000}
          max={5_000_000}
          step={10_000}
          onChange={setTvl}
          format={(v) => `$${v.toLocaleString()}`}
        />
        <p className="text-[11.5px] leading-relaxed text-[var(--color-dim)]">
          Assumes a 1% pool fee, the tier most Arc launchpads use. Your share of fees is your share
          of the vault — currently{" "}
          <span className="num font-semibold text-[var(--color-muted)]">
            {(share * 100).toFixed(2)}%
          </span>{" "}
          of it.
        </p>
      </div>

      <div className="flex flex-col justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
        <div className="label">Streamed to you</div>
        <div className="num mt-2 text-[34px] font-semibold leading-none tracking-[-0.02em]">
          {formatUsdCompact(BigInt(Math.round(daily * 1e6)))}
          <span className="ml-2 text-[15px] font-normal text-[var(--color-dim)]">/ day</span>
        </div>
        <dl className="mt-5 space-y-2 border-t border-[var(--color-border)] pt-4 text-[13px]">
          <Line label="Over a year" value={formatUsdCompact(BigInt(Math.round(yearly * 1e6)))} />
          <Line
            label="Implied APR"
            value={`${apr.toFixed(1)}%`}
            accent
          />
        </dl>
        <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
          This is multiplication, not a forecast. Volume is the one input nobody controls, and a
          quiet week pays quietly. It also ignores impermanent loss, which on a volatile token can
          exceed the fees entirely — <Link href="/docs/risks" className="text-[var(--color-accent)] underline">what that means</Link>.
        </p>
      </div>
    </div>
  );
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className={`num font-semibold ${accent ? "text-[var(--color-accent)]" : ""}`}>{value}</dd>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="num text-[13px] font-semibold">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider mt-2.5 w-full"
        aria-label={label}
      />
    </div>
  );
}

/** A question worth answering, with an answer that does not dodge. */
export function Faq({ items }: { items: { q: string; a: React.ReactNode }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {items.map((item, i) => (
        <div key={item.q}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <span className="text-[14px] font-medium">{item.q}</span>
            <span
              className={`shrink-0 text-[var(--color-dim)] transition-transform duration-200 ${
                open === i ? "rotate-45" : ""
              }`}
              aria-hidden
            >
              +
            </span>
          </button>
          {open === i && (
            <div className="px-5 pb-5 text-[13.5px] leading-relaxed text-[var(--color-muted)]">
              {item.a}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** How staking through a vault differs from the two things a person would otherwise do. */
export function ComparisonTable() {
  const rows: [string, string, string, string][] = [
    ["Fees you earn", "Yes, streamed in USDC", "Yes, but stranded in the position", "No — emissions instead"],
    ["Collecting them", "Automatic, by anyone", "You call collect, and pay gas", "You claim a minted token"],
    ["Token-side fees", "Converted to USDC for you", "You are left holding the token", "n/a"],
    ["Where yield comes from", "Real trading activity", "Real trading activity", "Inflation — someone is diluted"],
    ["Position shape", "Full range, never out of range", "Whatever you chose", "n/a"],
    ["Exit", "Any time, no lockup", "Any time", "Often locked or vested"],
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="label px-5 py-3.5 font-medium" />
            <th className="label px-4 py-3.5 font-medium text-[var(--color-accent-deep)]">
              Staking with Slice
            </th>
            <th className="label px-4 py-3.5 font-medium">Holding the LP yourself</th>
            <th className="label px-4 py-3.5 pr-5 font-medium">A typical farm</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map(([what, slice, lp, farm]) => (
            <tr key={what}>
              <td className="px-5 py-3.5 font-medium">{what}</td>
              <td className="bg-[var(--color-accent-dim)] px-4 py-3.5 text-[var(--color-accent-deep)]">
                {slice}
              </td>
              <td className="px-4 py-3.5 text-[var(--color-muted)]">{lp}</td>
              <td className="px-4 py-3.5 pr-5 text-[var(--color-muted)]">{farm}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
