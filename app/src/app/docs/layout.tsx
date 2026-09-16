"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const SECTIONS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Start here",
    links: [
      { href: "/docs", label: "What Delta is" },
      { href: "/docs/how-it-works", label: "How it works" },
    ],
  },
  {
    title: "For holders",
    links: [
      { href: "/docs/staking", label: "Staking liquidity" },
      { href: "/docs/fee-streaming", label: "The fee stream" },
      { href: "/docs/risks", label: "Risks" },
    ],
  },
  {
    title: "For creators",
    links: [{ href: "/docs/creator-routing", label: "Fee routing" }],
  },
  {
    title: "Reference",
    links: [
      { href: "/docs/arc", label: "Building on Arc" },
      { href: "/docs/security", label: "Security model" },
      { href: "/docs/contracts", label: "Contracts" },
    ],
  },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
      <aside className="lg:sticky lg:top-8 lg:h-fit">
        <nav className="space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                {section.title}
              </div>
              <ul className="space-y-0.5">
                {section.links.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className={`block rounded px-2 py-1 text-xs transition-colors ${
                          active
                            ? "bg-[var(--color-panel-2)] text-[var(--color-text)]"
                            : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 max-w-2xl pb-16">{children}</article>
    </div>
  );
}
