"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAddress, zeroAddress, type Address } from "viem";
import {
  usePublicClient,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Action, TxStatus, useNetworkGuard } from "@/components/tx";
import { Badge, TokenAvatar } from "@/components/ui";
import { targetChain } from "@/lib/chain";
import { ARC, erc20Abi, factoryAbi, FACTORY_ADDRESS, onArc } from "@/lib/contracts";
import { bufferedGas } from "@/lib/gas";
import { poolId, stateViewAbi, unsafeHookPermissions, usdcPoolKey } from "@/lib/pool";

/** A pool as the lookup reports it. */
type FoundPool = {
  poolId: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  liquidity: string;
  usdcQuoted: boolean;
  exitSafe: boolean;
  usable: boolean;
};

/**
 * List any USDC-quoted Uniswap v4 pool.
 *
 * `createVault` carries no access control, so this is not an admin screen — anyone can add a pool
 * and anyone can then stake in it. The page exists because a permissionless protocol behind a
 * curated-looking dashboard is indistinguishable from a permissioned one.
 *
 * It asks for a token address and nothing else. Asking for the hook and a fee tier chosen from
 * four presets failed twice over: the hook is only discoverable by reading an event log, and real
 * pools use fees well outside the common four — a live token whose pool charged 33% could not be
 * expressed in the form at all, so it looked unlistable.
 */
export default function NewPoolPage() {
  const guard = useNetworkGuard();
  const account = guard.account;
  const client = usePublicClient({ chainId: targetChain.id });

  const [token, setToken] = useState("");
  const [pools, setPools] = useState<FoundPool[]>([]);
  const [chosen, setChosen] = useState(0);
  const [lookup, setLookup] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [lookupNote, setLookupNote] = useState("");
  const lastLookedUp = useRef("");

  useEffect(() => {
    const t = token.trim().toLowerCase();
    if (!isAddress(t)) {
      setPools([]);
      setLookup("idle");
      lastLookedUp.current = "";
      return;
    }
    if (lastLookedUp.current === t) return;
    lastLookedUp.current = t;

    let cancelled = false;
    setLookup("searching");
    setLookupNote("");
    setPools([]);

    fetch(`/api/pool-lookup?token=${t}&chain=${targetChain.id}`)
      .then((r) => r.json())
      .then((d: { pools?: FoundPool[]; error?: string; reason?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setLookupNote(d.error);
          setLookup("error");
          return;
        }
        setPools(d.pools ?? []);
        setChosen(0);
        setLookupNote(d.reason ?? "");
        setLookup("done");
      })
      .catch(() => {
        if (!cancelled) {
          setLookupNote("could not reach the lookup");
          setLookup("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const selected = pools[chosen];

  // The key comes from the pool as it exists on chain, not from a preset. Uniswap v4 permits any
  // fee and tick spacing, and pools in the wild use values far outside the usual four.
  const key = useMemo(
    () =>
      selected && isAddress(token)
        ? usdcPoolKey(token as Address, selected.fee, selected.tickSpacing, selected.hooks as Address)
        : null,
    [selected, token],
  );
  const id = key ? poolId(key) : null;

  const reads = useReadContracts({
    contracts: onArc(
      id && FACTORY_ADDRESS
        ? [
            { address: ARC.STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [id] },
            { address: token as Address, abi: erc20Abi, functionName: "symbol" },
            {
              address: FACTORY_ADDRESS as Address,
              abi: factoryAbi,
              functionName: "vaultForPool",
              args: [id],
            },
          ]
        : [],
    ),
    query: { enabled: Boolean(id && FACTORY_ADDRESS) },
  });

  const d = reads.data;
  const slot0 = d?.[0]?.status === "success" ? (d[0].result as [bigint, number, number, number]) : null;
  const symbol = d?.[1]?.status === "success" ? (d[1].result as string) : null;
  const existing = d?.[2]?.status === "success" ? (d[2].result as Address) : zeroAddress;

  const initialized = Boolean(slot0 && slot0[0] > 0n);
  const alreadyListed = existing !== zeroAddress && isAddress(existing);
  const canCreate =
    Boolean(id) && initialized && !alreadyListed && Boolean(account) && Boolean(selected?.usable);

  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const create = useCallback(async () => {
    if (!key || !FACTORY_ADDRESS || !account) return;
    reset();
    // Listing a pool deploys a vault: ~4.2M gas, the heaviest call here by a wide margin, and
    // therefore the one with most to lose from an estimate taken with no headroom. See lib/gas.ts.
    const gas = await bufferedGas(client, {
      address: FACTORY_ADDRESS as Address,
      abi: factoryAbi,
      functionName: "createVault",
      args: [key],
      account,
    });
    writeContract({
      address: FACTORY_ADDRESS as Address,
      abi: factoryAbi,
      functionName: "createVault",
      args: [key],
      ...(gas === undefined ? {} : { gas }),
    });
  }, [key, writeContract, reset, client, account]);

  return (
    <div className="space-y-8">
      <div>
        <div className="label">Permissionless</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">List a pool</h1>
        <p className="mt-3 max-w-2xl text-[var(--color-muted)]">
          Anyone can create a vault for any USDC-quoted Uniswap v4 pool on Arc, and anyone can then
          stake in it. There is no allowlist and no approval step — paste a token address and its
          pool is found for you.{" "}
          <Link href="/docs/contracts#compatibility" className="text-[var(--color-accent)] underline">
            What qualifies
          </Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="panel space-y-5 p-6">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em]">Token</h2>
            <p className="mt-1 text-[13px] text-[var(--color-muted)]">
              The non-USDC side of the pair. Everything else is read from the chain.
            </p>
          </div>

          <div>
            <div className="label">Token address</div>
            <input
              className="input mono mt-1.5"
              placeholder="0x…"
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              spellCheck={false}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-dim)]">
              {lookup === "searching"
                ? "Looking up this token's pools on Arc…"
                : lookup === "error"
                  ? `Lookup failed: ${lookupNote}`
                  : lookup === "done" && pools.length === 0
                    ? lookupNote || "No Uniswap v4 pool found for this token."
                    : lookup === "done"
                      ? `Found ${pools.length} pool${pools.length === 1 ? "" : "s"}. The one holding the most liquidity is selected.`
                      : "Paste an address and its pool is found automatically."}
            </p>
          </div>

          {pools.length > 0 && (
            <div>
              <div className="label mb-2">
                {pools.length === 1 ? "Its pool" : `Pools for this token (${pools.length})`}
              </div>
              <div className="space-y-2">
                {pools.map((p, i) => (
                  <button
                    key={p.poolId}
                    type="button"
                    onClick={() => setChosen(i)}
                    disabled={!p.usable}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      i === chosen
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                        : p.usable
                          ? "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                          : "border-[var(--color-border)] opacity-45"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="mono text-[13px] font-semibold">
                        {(p.fee / 10_000).toFixed(2)}% fee
                        <span className="ml-2 font-normal text-[var(--color-dim)]">
                          spacing {p.tickSpacing}
                        </span>
                      </span>
                      <Badge tone={BigInt(p.liquidity) > 0n ? "up" : "neutral"}>
                        {BigInt(p.liquidity) > 0n ? "has liquidity" : "empty"}
                      </Badge>
                    </div>
                    <div className="mono mt-1 truncate text-[11px] text-[var(--color-dim)]">
                      hook {p.hooks === zeroAddress ? "none" : p.hooks}
                    </div>
                    {!p.usable && (
                      <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-warn)]">
                        {!p.usdcQuoted
                          ? "Not quoted in USDC — rewards are paid in USDC, so it has to be one side of the pair."
                          : `The hook ${unsafeHookPermissions(p.hooks as Address).join(", ")}, so the vault refuses this pool.`}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="panel space-y-4 p-6">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em]">Check</h2>
            <p className="mt-1 text-[13px] text-[var(--color-muted)]">
              Runs before you spend gas on a transaction.
            </p>
          </div>

          {!selected ? (
            <p className="text-[13px] text-[var(--color-muted)]">
              Enter a token address to check its pool.
            </p>
          ) : (
            <>
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                <div className="label">Pool id</div>
                <div className="mono mt-1 break-all text-[11px] text-[var(--color-muted)]">{id}</div>
              </div>

              {reads.isLoading ? (
                <p className="text-[13px] text-[var(--color-muted)]">Reading the pool…</p>
              ) : !initialized ? (
                <Row tone="bad" title="PoolNotInitialized">
                  The chain reports no pool at this id, which should not happen for one found in an
                  Initialize event. Try another pool from the list.
                </Row>
              ) : alreadyListed ? (
                <Row tone="good" title="Already listed">
                  This pool already has a vault.{" "}
                  <Link href={`/vault/${existing}`} className="underline">
                    Open it
                  </Link>
                  .
                </Row>
              ) : (
                <>
                  <Row tone="good" title="Pool is live">
                    {symbol ? (
                      <span className="inline-flex items-center gap-2">
                        <TokenAvatar address={token} symbol={symbol} size={18} />
                        <span className="mono">{symbol}</span> / USDC at{" "}
                        {(selected.fee / 10_000).toFixed(2)}%
                      </span>
                    ) : (
                      <>Initialised on {targetChain.name}.</>
                    )}
                  </Row>
                  <Row tone="good" title="Hook is exit-safe">
                    {selected.hooks === zeroAddress
                      ? "This pool has no hook at all, so nothing can interfere with a withdrawal."
                      : "Carries no remove-liquidity permission and cannot return a delta on add or remove, so it can never block or skim a withdrawal."}
                  </Row>
                  {BigInt(selected.liquidity) === 0n && (
                    <Row tone="warn" title="Pool has no liquidity">
                      A vault can still be created, but it earns nothing until somebody provides
                      liquidity to the pool itself.
                    </Row>
                  )}
                </>
              )}

              {receipt.isSuccess ? (
                <Row tone="good" title="Vault created">
                  It is live and stakeable now.{" "}
                  <Link href="/pools" className="underline">
                    See it in the pool list
                  </Link>
                  . Two-sided deposits work immediately; USDC-only follows in about half an hour,
                  once the vault&apos;s price average spans its window.
                </Row>
              ) : (
                <Action
                  guard={guard}
                  busy={isPending || receipt.isLoading}
                  disabled={!canCreate}
                  onClick={create}
                  label={account ? "Create vault" : "Connect a wallet to list"}
                />
              )}

              <TxStatus
                hash={txHash}
                isPending={isPending}
                isConfirming={receipt.isLoading}
                isSuccess={false}
                error={writeError}
              />

              <p className="text-[12px] leading-relaxed text-[var(--color-dim)]">
                Creating a vault costs gas and nothing else. It gives you no special rights over the
                vault — the owner and fee recipient are set by the factory, identically for every
                pool.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  tone,
  title,
  children,
}: {
  tone: "good" | "warn" | "bad";
  title: string;
  children: React.ReactNode;
}) {
  // Badge speaks in up/down/warn; this page speaks in pass/fail. Map rather than widen Badge,
  // which is used for market figures elsewhere and should not grow a second vocabulary.
  const badgeTone = ({ good: "up", warn: "warn", bad: "down" } as const)[tone];
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 whitespace-nowrap">
        <Badge tone={badgeTone}>{title}</Badge>
      </span>
      <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-[var(--color-muted)]">
        {children}
      </p>
    </div>
  );
}
