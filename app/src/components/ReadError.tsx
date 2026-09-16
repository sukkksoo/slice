"use client";

import { useState } from "react";

import { targetChain } from "@/lib/chain";
import { ARC, FACTORY_ADDRESS } from "@/lib/contracts";

/**
 * What to show when the chain cannot be read.
 *
 * The previous version printed viem's own message, which runs to several lines of ABI internals
 * and a docs link, and tells a visitor nothing they can act on. Worse, the most common cause is
 * not a fault in the protocol at all — an extension or network intercepting the RPC call, or a
 * stale cached bundle — so an alarming red wall of text misrepresents what has happened.
 *
 * This says what failed, offers the two fixes that actually resolve it, and keeps the technical
 * detail one click away for anyone who wants it.
 */
export function ReadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const [open, setOpen] = useState(false);

  // viem reports an empty eth_call result this way. It means the address being called has no code
  // on whichever chain answered — so the call reached *a* node, just not one running Arc.
  const emptyResult = /zero data|returned no data|0x"\)/i.test(error.message);

  return (
    <div className="panel mt-5 border-[var(--color-warn)] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[14px] font-semibold text-[var(--color-warn)]">
          Could not read {targetChain.name}
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn btn-ghost px-3 py-1.5 text-xs">
            Try again
          </button>
        )}
      </div>

      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--color-muted)]">
        {emptyResult ? (
          <>
            A node answered, but reported no contract at the factory address — which means the
            request reached a network other than {targetChain.name}. That is almost always a wallet
            or privacy extension redirecting RPC traffic, or a cached copy of this page from before
            it moved to {targetChain.name}.
          </>
        ) : (
          <>
            The app could not reach an {targetChain.name} node just now. This is usually a passing
            network problem rather than anything wrong with the protocol.
          </>
        )}
      </p>

      <ul className="mt-3 space-y-1.5 text-[13px] text-[var(--color-muted)]">
        <li>· Hard-reload the page (Ctrl+Shift+R) to clear a stale copy.</li>
        <li>· Try a private window, which runs without extensions.</li>
        <li>
          · Your funds are unaffected either way — this is a display problem. The contracts are
          readable directly on the explorer.
        </li>
      </ul>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-3 text-[12px] text-[var(--color-dim)] underline transition-colors hover:text-[var(--color-muted)]"
      >
        {open ? "Hide technical detail" : "Technical detail"}
      </button>
      {open && (
        <div className="mono mt-2 space-y-1 overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-3 text-[11px] text-[var(--color-muted)]">
          <div>chain: {targetChain.name} ({targetChain.id})</div>
          <div>rpc: {targetChain.rpcUrls.default.http[0]}</div>
          <div>factory: {FACTORY_ADDRESS || "(not configured)"}</div>
          <div>usdc: {ARC.USDC}</div>
          <div className="pt-1 opacity-70">{error.message.split("\n")[0]}</div>
        </div>
      )}
    </div>
  );
}
