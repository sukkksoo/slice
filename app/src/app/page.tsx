"use client";

import Link from "next/link";
import { useMemo } from "react";

import { FlowDiagram } from "@/components/Brand";
import { LiveBadge, PairAvatar, StatBar } from "@/components/ui";
import { useVaults } from "@/hooks/useVaults";
import { formatPercent, formatUsdCompact } from "@/lib/format";
import { targetChain } from "@/lib/chain";

export default function LandingPage() {
  const { vaults, configured, isLoading } = useVaults();

  const totals = useMemo(() => {
    const tvl = vaults.reduce((acc, v) => acc + v.tvlUsdc, 0n);
    const queued = vaults.reduce((acc, v) => acc + v.pendingCompound, 0n);
    const streaming = vaults.filter((v) => v.rewardRate > 0n).length;
    return { tvl, queued, streaming, count: vaults.length };
  }, [vaults]);

  // Show a real pool in the hero rather than a decorative illustration.
  const featured = useMemo(
    () => [...vaults].sort((a, b) => (b.tvlUsdc > a.tvlUsdc ? 1 : -1))[0],
    [vaults],
  );

  return (
    <div className="space-y-24 pb-8">
      {/* --- hero --- */}
      <section className="grid items-start gap-12 pt-8 sm:pt-14 lg:grid-cols-[1.25fr_0.75fr]">
        <div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
          <span className="live-dot size-1.5 rounded-full bg-[var(--color-accent)]" />
          Live on {targetChain.name} · Uniswap v4
        </span>

        <h1 className="mt-7 max-w-3xl text-[40px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[58px]">
          Liquidity that
          <br />
          <span className="accent-text">pays you back.</span>
        </h1>

        <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-[var(--color-muted)]">
          Stake liquidity in any token and earn a share of that pool&apos;s trading fees — paid in
          USDC, streamed second by second. Or route your token&apos;s fees straight back into its own
          liquidity, automatically.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/pools" className="btn btn-primary px-5 py-2.5 text-[14px]">
            Browse pools
          </Link>
          <Link href="/docs" className="btn btn-ghost px-5 py-2.5 text-[14px]">
            How it works
          </Link>
        </div>

        </div>

        {/* A real pool, live, rather than a decorative illustration. */}
        {featured && (
          <Link
            href={`/vault/${featured.address}`}
            className="panel-raised hidden p-6 lg:block"
          >
            <div className="flex items-center justify-between">
              <span className="label">Live pool</span>
              <LiveBadge warm={featured.oracleWarm} />
            </div>

            <div className="mt-5 flex items-center gap-3">
              <PairAvatar address={featured.assetToken} symbol={featured.symbol} />
              <div>
                <div className="text-[15px] font-semibold">
                  {featured.symbol} <span className="text-[var(--color-dim)]">/ USDC</span>
                </div>
                <div className="text-xs text-[var(--color-dim)]">Uniswap v4 · full range</div>
              </div>
            </div>

            <dl className="mt-6 space-y-3 border-t border-[var(--color-border)] pt-5">
              <div className="flex items-baseline justify-between">
                <dt className="text-[13px] text-[var(--color-muted)]">TVL</dt>
                <dd className="num text-[15px] font-semibold">
                  {formatUsdCompact(featured.tvlUsdc)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-[13px] text-[var(--color-muted)]">Stream APR</dt>
                <dd className="num text-[15px] font-semibold text-[var(--color-up)]">
                  {featured.rewardRate > 0n ? formatPercent(featured.aprPercent) : "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-[13px] text-[var(--color-muted)]">Fees paid in</dt>
                <dd className="text-[15px] font-semibold">USDC</dd>
              </div>
            </dl>

            <div className="btn btn-ghost mt-6 w-full">Stake into this pool</div>
          </Link>
        )}
      </section>

      {configured && (
        <section className="-mt-10 border-t border-[var(--color-border)] pt-8">
          {isLoading && vaults.length === 0 ? (
            <div className="flex gap-9">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <div className="skeleton h-3 w-20" />
                  <div className="skeleton mt-2.5 h-7 w-24" />
                </div>
              ))}
            </div>
          ) : (
            <StatBar
              items={[
                { label: "Total value locked", value: formatUsdCompact(totals.tvl) },
                { label: "Pools", value: String(totals.count) },
                { label: "Streaming fees", value: String(totals.streaming), tone: "accent" },
                { label: "Queued to compound", value: formatUsdCompact(totals.queued) },
              ]}
            />
          )}
        </section>
      )}

      {/* --- two audiences --- */}
      <section className="grid gap-5 lg:grid-cols-2">
        <Audience
          tag="For holders"
          title="Earn real fees, not emissions"
          body="Deposit into a pool's vault and receive shares. Every swap that crosses the pool pays a fee; those fees are collected, converted to USDC, and streamed to you. Nothing is minted to pay you — the yield is the pool's own trading activity."
          points={[
            "Deposit USDC alone, or both sides of the pair",
            "Rewards accrue in USDC, claimable any time",
            "No lockup — withdraw whenever",
          ]}
          href="/pools"
          cta="See the pools"
        />
        <Audience
          tag="For creators"
          title="Deepen your liquidity on autopilot"
          body="Point a fee router at your pool and fund it with USDC — from a launchpad fee split, a treasury budget, or a plain transfer. It deploys that budget into liquidity on your schedule, or as the token crosses market-cap milestones."
          points={[
            "Cadence or market-cap triggers, priced off a TWAP",
            "Burn the shares to make liquidity permanent",
            "Anyone can trigger it — you never run a keeper",
          ]}
          href="/creator"
          cta="Set up routing"
        />
      </section>

      {/* --- how a fee becomes yield --- */}
      <section>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
          How a fee becomes your yield
        </h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--color-muted)]">
          Four steps, all on-chain, all triggerable by anyone.
        </p>

        <div className="panel mt-7 overflow-hidden px-6 py-8">
          {/* Constrained: the SVG scales with its container, so at full panel width its 11px
              labels would render around 30px. */}
          <div className="mx-auto max-w-[520px]">
            <FlowDiagram />
          </div>
        </div>

        <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Step
            n="01"
            title="A trade happens"
            body="Someone swaps against the pool and pays a fee. It accrues to the vault's position, pro-rata with every other staker."
          />
          <Step
            n="02"
            title="The vault harvests"
            body="Fees are collected and the token side converted to USDC — bounded by a TWAP, so it can never be priced at a manipulated moment."
          />
          <Step
            n="03"
            title="It streams, not dumps"
            body="Proceeds pay out linearly over seven days. Nobody can deposit right before a harvest and walk off with fees they never earned."
          />
          <Step
            n="04"
            title="You claim"
            body="Your share accrues every second and waits until you take it. Or leave it compounding into deeper liquidity."
          />
        </ol>

        <Link
          href="/docs/how-it-works"
          className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          Read the full mechanics
          <span aria-hidden>→</span>
        </Link>
      </section>

      {/* --- honesty --- */}
      <section className="panel-raised overflow-hidden">
        <div className="border-l-2 border-[var(--color-warn)] px-6 py-6 sm:px-8">
          <h2 className="text-base font-semibold text-[var(--color-warn)]">
            This is unaudited software
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)]">
            These contracts hold user funds and have not been reviewed by a third party. Development
            surfaced two fee-leak bugs and one bug that could have frozen every vault permanently.
            All three are fixed and covered by tests — but finding three real defects is evidence
            that more exist, not that the code is now clean.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/docs/risks" className="btn btn-ghost">
              What can go wrong
            </Link>
            <Link href="/docs/security" className="btn btn-ghost">
              Security model
            </Link>
          </div>
        </div>
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
    <div className="panel-raised flex flex-col p-7">
      <div className="label text-[var(--color-accent)]">{tag}</div>
      <h3 className="mt-3 text-[19px] font-semibold tracking-[-0.015em]">{title}</h3>
      <p className="mt-3.5 text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>

      <ul className="mt-6 space-y-3 border-t border-[var(--color-border)] pt-6">
        {points.map((p) => (
          <li key={p} className="flex gap-3 text-sm text-[var(--color-muted)]">
            <span className="mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full bg-[var(--color-accent-dim)] text-[10px] font-bold text-[var(--color-accent-deep)]">
              ✓
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <Link href={href} className="btn btn-ghost mt-7 self-start">
        {cta}
      </Link>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="panel p-5">
      <div className="num text-xs font-semibold text-[var(--color-accent)]">{n}</div>
      <h3 className="mt-2.5 text-[15px] font-semibold">{title}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">{body}</p>
    </li>
  );
}
