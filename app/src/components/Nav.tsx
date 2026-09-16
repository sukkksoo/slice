"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";

import { targetChain } from "@/lib/wagmi";
import { shortAddress } from "@/lib/format";

const TABS = [
  { href: "/", label: "Pools" },
  { href: "/stakes", label: "Stakes" },
  { href: "/creator", label: "Creator" },
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
    <header className="border-b border-[var(--color-border)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded bg-[var(--color-accent-dim)] text-sm font-bold text-[var(--color-accent)]">
            Δ
          </span>
          <span className="text-sm font-semibold tracking-tight">
            Delta <span className="text-[var(--color-muted)]">on {targetChain.name}</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "bg-[var(--color-panel-2)] text-[var(--color-text)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {wrongChain && (
            <button
              type="button"
              onClick={() => switchChain({ chainId: targetChain.id })}
              className="rounded border border-[var(--color-warn)] px-3 py-1.5 text-xs text-[var(--color-warn)]"
            >
              {`Switch to ${targetChain.name}`}
            </button>
          )}

          {isConnected ? (
            <button
              type="button"
              onClick={() => disconnect()}
              className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              {address ? shortAddress(address) : "Disconnect"}
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending || connectors.length === 0}
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
              className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
            >
              {isPending ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
