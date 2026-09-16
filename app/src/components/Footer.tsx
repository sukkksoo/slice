"use client";

import Link from "next/link";

import { targetChain } from "@/lib/wagmi";

const GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/pools", label: "Pools" },
      { href: "/stakes", label: "Stakes" },
      { href: "/creator", label: "Creator" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs", label: "What Delta is" },
      { href: "/docs/how-it-works", label: "How it works" },
      { href: "/docs/fee-streaming", label: "The fee stream" },
      { href: "/docs/creator-routing", label: "Fee routing" },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/docs/arc", label: "Building on Arc" },
      { href: "/docs/security", label: "Security" },
      { href: "/docs/risks", label: "Risks" },
      { href: "/docs/contracts", label: "Contracts" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-[var(--color-border)]">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded bg-[var(--color-accent-dim)] text-xs font-bold text-[var(--color-accent)]">
                Δ
              </span>
              <span className="text-xs font-semibold">Delta</span>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
              Liquidity infrastructure for Arc. Stake liquidity, earn streamed fees, route creator
              fees into automatic liquidity.
            </p>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                {group.title}
              </div>
              <ul className="mt-3 space-y-1.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-6 text-[11px] text-[var(--color-muted)]">
          <span className="text-[var(--color-warn)]">Unaudited software.</span>
          <span>
            {targetChain.name} · chain {targetChain.id}
          </span>
          <span>Uniswap v4</span>
          <span>Gas paid in USDC</span>
        </div>
      </div>
    </footer>
  );
}
