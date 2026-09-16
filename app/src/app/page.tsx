"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useVaults } from "@/hooks/useVaults";
import { formatUsdCompact } from "@/lib/format";
import { targetChain } from "@/lib/wagmi";

export default function LandingPage() {
  const { vaults, configured } = useVaults();

  const totals = useMemo(() => {
    const tvl = vaults.reduce((acc, v) => acc + v.tvlUsdc, 0n);
    const streaming = vaults.filter((v) => v.rewardRate > 0n).length;
    return { tvl, streaming, count: vaults.length };
  }, [vaults]);

  return (
    <div className="space-y-16 pb-12">
      {/* --- hero --- */}
      <section className="pt-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 py-1 text-[11px] text-[var(--color-muted)]">
          <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
          Live on {targetChain.name} · Uniswap v4
        </div>

        <h1 className="mt-5 max-w-2xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
          Liquidity infrastructure for Arc.
        </h1>

        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">
          Stake your liquidity in any token and earn a share of that pool&apos;s trading fees, paid
          in USDC and streamed over time. Or, as a token creator, route fees into your own pool
          automatically — on a schedule, or as your market cap climbs.
        </p>

        <div className="mt-7 flex flex-wrap gap-2">
          <Link
            href="/pools"
            className="rounded bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-black"
          >
            Browse pools
          </Link>
          <Link
            href="/docs"
            className="rounded border border-[var(--color-border)] px-4 py-2 text-xs font-semibold hover:border-[var(--color-accent)]"
          >
            Read the docs
          </Link>
        </div>

        {configured && (
          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 border-t border-[var(--color-border)] pt-6">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                Total value locked
              </dt>
              <dd className="num mt-1 text-lg font-semibold">{formatUsdCompact(totals.tvl)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                Pools
              </dt>
              <dd className="num mt-1 text-lg font-semibold">{totals.count}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                Streaming fees
              </dt>
              <dd className="num mt-1 text-lg font-semibold text-[var(--color-accent)]">
                {totals.streaming}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* --- two audiences --- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Audience
          tag="For holders"
          title="Earn real fees, not emissions"
          body="Deposit into a pool's vault and receive shares. Every swap that crosses the pool pays a fee; those fees are collected, converted to USDC, and streamed to you second by second. Nothing is minted to pay you — the yield is the pool's own trading activity."
          points={[
            "Deposit USDC alone, or both sides of the pair",
            "Rewards accrue in USDC and can be claimed any time",
            "Withdraw whenever you like — no lockup",
          ]}
          href="/pools"
          cta="See the pools"
        />
        <Audience
          tag="For creators"
          title="Deepen your own liquidity, on autopilot"
          body="Point a fee router at your pool and fund it with USDC — from a launchpad fee split, a treasury budget, or a plain transfer. It deploys that budget into liquidity on the schedule you set, or as the token crosses market-cap milestones you choose."
          points={[
            "Cadence or market-cap triggers, priced off a TWAP",
            "Burn the shares to make added liquidity permanent",
            "Anyone can trigger it — you never run a keeper",
          ]}
          href="/creator"
          cta="Set up routing"
        />
      </section>

      {/* --- how it works, short --- */}
      <section>
        <h2 className="text-base font-semibold tracking-tight">How a fee becomes your yield</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Step
            n="01"
            title="A trade happens"
            body="Someone swaps against the pool and pays a fee. It accrues to the vault's liquidity position, pro-rata with everyone else's."
          />
          <Step
            n="02"
            title="The vault harvests"
            body="Fees are collected and the token side is converted to USDC, bounded by a TWAP so the conversion can't be priced at a manipulated moment."
          />
          <Step
            n="03"
            title="It streams, not dumps"
            body="The proceeds pay out linearly over seven days rather than landing at once — so nobody can deposit right before a harvest and capture fees they never earned."
          />
          <Step
            n="04"
            title="You claim"
            body="Your share accrues every second and sits there until you take it. Or leave it compounding into deeper liquidity."
          />
        </div>
        <p className="mt-5 text-[11px] text-[var(--color-muted)]">
          <Link href="/docs/how-it-works" className="text-[var(--color-accent)] hover:underline">
            Read the full mechanics →
          </Link>
        </p>
      </section>

      {/* --- honesty --- */}
      <section className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-panel)] px-5 py-4">
        <div className="text-xs font-semibold text-[var(--color-warn)]">
          This is unaudited software
        </div>
        <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-[var(--color-muted)]">
          These contracts hold user funds and have not been reviewed by a third party. Development
          surfaced two real fee-leak bugs and one vault-freezing bug, all of which are fixed and
          covered by tests — but that history is a reason to expect more, not fewer, undiscovered
          issues. The{" "}
          <Link href="/docs/risks" className="text-[var(--color-accent)] hover:underline">
            risks page
          </Link>{" "}
          documents what can still go wrong, including the parts nothing on-chain can defend
          against.
        </p>
      </section>
    </div>
  );
}

function Audience({
  tag,
  title,
  body,
  points,
  href,
  cta,
}: {
  tag: string;
  title: string;
  body: string;
  points: string[];
  href: string;
  cta: string;
}) {
  return (
    <div className="panel flex flex-col p-6">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-accent)]">{tag}</div>
      <h3 className="mt-2 text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">{body}</p>
      <ul className="mt-4 space-y-1.5 text-xs text-[var(--color-muted)]">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span className="text-[var(--color-accent)]">→</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <Link
        href={href}
        className="mt-5 inline-block self-start rounded border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--color-accent)]"
      >
        {cta}
      </Link>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="panel p-4">
      <div className="num text-[10px] text-[var(--color-accent)]">{n}</div>
      <div className="mt-1.5 text-xs font-semibold">{title}</div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">{body}</p>
    </div>
  );
}
