"use client";

import Link from "next/link";
import { useMemo } from "react";

import { FlowDiagram } from "@/components/Brand";
import { ComparisonTable, Faq, FeeWaterfall, YieldCalculator } from "@/components/explain";
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
              <LiveBadge warm={featured.canSwap} />
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
            <>
              {/* Four zeroes across the top of a landing page reads as a broken product rather
                  than a new one. Until something is deposited, say plainly that nothing is —
                  which is both more honest and less alarming than $0.00 repeated. */}
              {totals.tvl === 0n ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="label">No deposits yet</div>
                    <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">
                      The contracts are live on {targetChain.name} with{" "}
                      <span className="num font-semibold text-[var(--color-text)]">
                        {totals.count}
                      </span>{" "}
                      {totals.count === 1 ? "pool" : "pools"} listed, and nothing staked in them so
                      far. Figures appear here as soon as they do.
                    </p>
                  </div>
                  <Link href="/pools" className="btn btn-ghost">
                    Be the first
                  </Link>
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
            </>
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

        <div className="mt-7 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="panel flex items-center justify-center overflow-hidden px-6 py-8">
            {/* Constrained: the SVG scales with its container, so at full panel width its 11px
                labels would render around 30px. */}
            <div className="mx-auto w-full max-w-[420px]">
              <FlowDiagram />
            </div>
          </div>
          <div className="panel px-6 py-6">
            <div className="label">Worked example</div>
            <h3 className="mt-1.5 text-[15px] font-semibold">A pool trading $50,000 in a day</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              Every number below is the protocol&apos;s own arithmetic, not a projection.
            </p>
            <div className="mt-5">
              <FeeWaterfall />
            </div>
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

      {/* --- what it would actually pay --- */}
      <section>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">What would it pay you?</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Fee income is volume multiplied by the pool&apos;s fee, split by how much of the vault you
          own. Move the inputs and watch it — there is no hidden model.
        </p>
        <div className="panel mt-7 px-6 py-7">
          <YieldCalculator />
        </div>
      </section>

      {/* --- versus the alternatives --- */}
      <section>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
          Against the two things you would do otherwise
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Provide liquidity yourself and the fees are real but stranded in the position. Farm, and
          the yield is minted rather than earned. Slice is the same fees with the collection
          automated and the payout in USDC.
        </p>
        <div className="mt-7">
          <ComparisonTable />
        </div>
      </section>

      {/* --- questions --- */}
      <section>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Questions worth asking</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Including the ones with uncomfortable answers.
        </p>
        <div className="mt-7">
          <Faq
            items={[
              {
                q: "Can you take my deposit?",
                a: (
                  <>
                    No. There is no function that moves a staker&apos;s principal — not for the
                    owner, not for anyone. The owner can change fee rates within fixed caps and
                    point fees at a different address, and that is the whole of it. Withdrawals
                    cannot be paused because nothing exists to pause them with. Every one of those
                    claims is checkable on the{" "}
                    <Link href="/docs/contracts" className="text-[var(--color-accent)] underline">
                      contracts page
                    </Link>
                    .
                  </>
                ),
              },
              {
                q: "What can I actually lose?",
                a: (
                  <>
                    Two things. <strong>Impermanent loss</strong>: a full-range position sells into
                    a rise and buys into a fall, so if the token moves hard you end up with less
                    value than if you had simply held — and on a volatile token that can exceed the
                    fees entirely. And <strong>a bug</strong>: these contracts are unaudited and
                    hold real funds.{" "}
                    <Link href="/docs/risks" className="text-[var(--color-accent)] underline">
                      The full list
                    </Link>
                    .
                  </>
                ),
              },
              {
                q: "Why is my deposit sometimes refused?",
                a: (
                  <>
                    A USDC-only deposit makes the vault swap half your input, and it will only do
                    that when the pool&apos;s spot price sits close to its own 30-minute average.
                    If the token has just moved sharply that check fails, and the deposit is paused
                    rather than executed at a dislocated price. Supplying both sides never swaps,
                    so it always works. Withdrawals and claims are never affected.
                  </>
                ),
              },
              {
                q: "What do you charge?",
                a: (
                  <>
                    A <strong>0.5% entry fee</strong>, and <strong>10% of the fees a pool
                    produces</strong>. The protocol fee already sits at its own hard ceiling, so it
                    can be lowered but never raised — the rate you read on the day you deposit is
                    the worst it will ever be. No exit fee and no lockup.{" "}
                    <Link href="/docs/fees" className="text-[var(--color-accent)] underline">
                      Every charge, itemised
                    </Link>
                    .
                  </>
                ),
              },
              {
                q: "Who keeps it running?",
                a: (
                  <>
                    Anyone. Harvesting, compounding and recording a price are all permissionless,
                    and none of them lets the caller redirect a cent — the conditions decide whether
                    a call is valid, not who made it. If everyone involved in building this walked
                    away, the vaults would keep working and the money would still come out.
                  </>
                ),
              },
              {
                q: "Which pools can I stake in?",
                a: (
                  <>
                    Any Uniswap v4 pool on Arc quoted in USDC whose hook cannot interfere with a
                    withdrawal. That covers most launchpad tokens, Argus included. There is no
                    allowlist: if the pool you want has no vault yet,{" "}
                    <Link href="/pools/new" className="text-[var(--color-accent)] underline">
                      create one yourself
                    </Link>{" "}
                    — doing so gives you no special rights over it.
                  </>
                ),
              },
            ]}
          />
        </div>
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
