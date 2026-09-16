"use client";

import Link from "next/link";

import { Logo } from "@/components/Brand";
import { targetChain } from "@/lib/chain";

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
      { href: "/docs", label: "What Sluice is" },
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
    <footer className="mt-24 border-t border-[var(--color-border)]">
      <div className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo size={28} />
              <span className="text-sm font-semibold">Sluice</span>
            </div>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-[var(--color-muted)]">
              Liquidity infrastructure for Arc. Stake liquidity and earn streamed fees, or route
              creator fees into automatic on-chain liquidity.
            </p>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="label">{group.title}</div>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[13px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-dim)]">
          <span className="rounded-full bg-[var(--color-warn-dim)] px-2.5 py-1 font-medium text-[var(--color-warn)]">
            Unaudited software
          </span>
          <span>
            {targetChain.name} · chain <span className="num">{targetChain.id}</span>
          </span>
          <span>Uniswap v4</span>
          <span>Gas paid in USDC</span>
        </div>
      </div>
    </footer>
  );
}
