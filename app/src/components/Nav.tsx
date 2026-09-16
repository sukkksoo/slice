"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

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
  // `chainId` is the wallet's real chain, unsupported ones included. useChainId() would report the
  // config's chain instead, so a wallet parked on Ethereum would read as "on Arc" through it.
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== targetChain.id;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[rgba(255,255,255,0.72)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-3.5 sm:gap-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="hidden text-[15px] font-semibold tracking-[-0.01em] sm:block">Slice</span>
        </Link>

        <nav className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((tab) => {
            const active =
              tab.href === "/docs" ? pathname.startsWith("/docs") : pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors sm:px-3 ${
                  active
                    ? "bg-[var(--color-accent-dim)] text-[var(--color-accent-deep)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] md:inline-flex">
            <span className="live-dot size-1.5 rounded-full bg-[var(--color-up)]" />
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
              {isPending ? "Connecting…" : (<><span className="sm:hidden">Connect</span><span className="hidden sm:inline">Connect wallet</span></>)}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
