"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { Logo } from "@/components/Brand";
import { targetChain } from "@/lib/chain";
import { shortAddress } from "@/lib/format";

const TABS = [
  { href: "/pools", label: "Pools" },
  { href: "/stakes", label: "Stakes" },
  { href: "/creator", label: "Creator" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== targetChain.id;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="hidden text-[15px] font-semibold tracking-[-0.01em] sm:block">Sluice</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          {TABS.map((tab) => {
            const active =
              tab.href === "/docs" ? pathname.startsWith("/docs") : pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-[var(--color-surface-3)] text-[var(--color-text)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] md:inline-flex">
            <span className="live-dot size-1.5 rounded-full bg-[var(--color-accent)]" />
            {targetChain.name}
          </span>

          {wrongChain && (
            <button
              type="button"
              onClick={() => switchChain({ chainId: targetChain.id })}
              className="btn border border-[var(--color-warn)] bg-[var(--color-warn-dim)] text-[var(--color-warn)]"
            >
              Switch network
            </button>
          )}

          {isConnected ? (
            <button type="button" onClick={() => disconnect()} className="btn btn-ghost">
              <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
              <span className="mono text-xs">{address ? shortAddress(address) : "Connected"}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending || connectors.length === 0}
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
              className="btn btn-primary"
            >
              {isPending ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
