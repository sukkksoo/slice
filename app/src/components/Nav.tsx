"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  const { connect, connectors, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== targetChain.id;

  // A dropdown that cannot be dismissed by clicking away is a trap on a phone, where there is no
  // Escape key and the button sits under a thumb.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPickerOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[rgba(7,11,26,0.72)] backdrop-blur-xl backdrop-saturate-150">
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
          ) : connectors.length === 1 ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => connect({ connector: connectors[0]! })}
              className="btn btn-primary"
            >
              {isPending ? "Connecting…" : <ConnectLabel />}
            </button>
          ) : (
            <div ref={pickerRef} className="relative">
              <button
                type="button"
                disabled={isPending || connectors.length === 0}
                onClick={() => setPickerOpen((o) => !o)}
                className="btn btn-primary"
              >
                {isPending ? "Connecting…" : <ConnectLabel />}
              </button>
              {pickerOpen && (
                <div className="panel-raised absolute right-0 top-[calc(100%+6px)] z-10 w-60 overflow-hidden p-1">
                  {connectors.map((c) => (
                    <button
                      key={c.uid}
                      type="button"
                      onClick={() =>
                        connect(
                          { connector: c },
                          { onSuccess: () => setPickerOpen(false) },
                        )
                      }
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      {c.name}
                    </button>
                  ))}
                  {connectError && (
                    <p className="border-t border-[var(--color-border)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-down)]">
                      {/^User rejected|denied/i.test(connectError.message)
                        ? "You dismissed the request in your wallet."
                        : connectError.message.split("\n")[0].slice(0, 120)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function ConnectLabel() {
  return (
    <>
      <span className="sm:hidden">Connect</span>
      <span className="hidden sm:inline">Connect wallet</span>
    </>
  );
}
