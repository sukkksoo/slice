"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const SECTIONS = [
  {
    title: "Start here",
    links: [
      { href: "/docs", label: "What Slice is" },
      { href: "/docs/glossary", label: "Plain English" },
      { href: "/docs/how-it-works", label: "How it works" },
    ],
  },
  {
    title: "For holders",
    links: [
      { href: "/docs/staking", label: "Staking liquidity" },
      { href: "/docs/fee-streaming", label: "The fee stream" },
      { href: "/docs/fees", label: "Fees" },
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
    <div className="grid gap-12 lg:grid-cols-[210px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:h-fit">
        <nav className="space-y-7">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="label mb-3">{section.title}</div>
              <ul className="space-y-0.5 border-l border-[var(--color-border)]">
                {section.links.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className={`-ml-px block border-l py-1.5 pl-4 text-[13.5px] transition-colors ${
                          active
                            ? "border-[var(--color-accent)] font-medium text-[var(--color-text)]"
                            : "border-transparent text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
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

      <article className="min-w-0 max-w-[680px] pb-20">{children}</article>
    </div>
  );
}
