"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useDisconnect } from "wagmi";

import { targetChain } from "@/lib/chain";
import { formatAmount, shortAddress } from "@/lib/format";
import { explorerAddress } from "@/lib/tx";

/**
 * The connected account, and what you can do with it.
 *
 * The button previously disconnected on click with nothing to say so: the only affordance was an
 * address, and clicking it silently ended the session. Someone wanting to copy their address, or
 * open it on the explorer, or simply see their balance, had no way to do any of it, and someone
 * who clicked out of curiosity was logged out. Disconnect belongs in a menu where it is labelled.
 */
export function AccountMenu() {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Gas on Arc is USDC, and the native balance carries 18 decimals rather than the 6 the ERC-20
  // interface exposes — formatting it with the token's decimals would overstate it by 1e12.
  const balance = useBalance({ address, chainId: targetChain.id, query: { enabled: Boolean(address) } });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!address) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard is unavailable over plain http and in some embedded browsers */
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn btn-ghost"
      >
        <span className="live-dot size-1.5 rounded-full bg-[var(--color-up)]" />
        <span className="mono text-xs">{shortAddress(address)}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="panel-raised absolute right-0 top-[calc(100%+6px)] z-10 w-60 overflow-hidden p-1"
        >
          <div className="border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="label">Connected to {targetChain.name}</div>
            <div className="mono mt-1 truncate text-[12px] text-[var(--color-muted)]">{address}</div>
            <div className="num mt-1.5 text-[12px]">
              {balance.data
                ? `${formatAmount(balance.data.value, balance.data.decimals, 4)} USDC`
                : "—"}
              <span className="ml-1.5 text-[var(--color-dim)]">for gas</span>
            </div>
          </div>

          <MenuItem onClick={copy}>{copied ? "Copied" : "Copy address"}</MenuItem>
          <MenuItem href={explorerAddress(address)} external>
            View on explorer
          </MenuItem>
          <MenuItem href="/stakes" onClick={() => setOpen(false)}>
            Your stakes
          </MenuItem>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <MenuItem
            danger
            onClick={() => {
              setOpen(false);
              disconnect();
            }}
          >
            Disconnect
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  href,
  external,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  danger?: boolean;
}) {
  const className = `flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-2)] ${
    danger ? "text-[var(--color-down)]" : ""
  }`;

  if (href && external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" role="menuitem" className={className}>
        {children}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} onClick={onClick} role="menuitem" className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
