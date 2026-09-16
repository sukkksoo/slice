"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isAddress, zeroAddress, type Address } from "viem";
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { Badge, TokenAvatar } from "@/components/ui";
import { targetChain } from "@/lib/chain";
import { ARC, erc20Abi, factoryAbi, FACTORY_ADDRESS, onArc } from "@/lib/contracts";
import {
  FEE_TIERS,
  poolId,
  stateViewAbi,
  usdcPoolKey,
  validatePool,
} from "@/lib/pool";

/**
 * List any USDC-quoted Uniswap v4 pool.
 *
 * `createVault` carries no access control, so this is not an admin screen — anyone can add a pool
 * and anyone can then stake in it. The page exists because a permissionless protocol behind a
 * curated-looking dashboard is indistinguishable from a permissioned one.
 */
export default function NewPoolPage() {
  const { address: account } = useAccount();
  const [token, setToken] = useState("");
  const [hooks, setHooks] = useState(zeroAddress as string);
  const [tier, setTier] = useState(3);

  const { fee, tickSpacing } = FEE_TIERS[tier];
  const problems = useMemo(
    () => (token || hooks ? validatePool(token, hooks) : []),
    [token, hooks],
  );

  const inputsUsable = isAddress(token) && isAddress(hooks) && problems.length === 0;
  const key = useMemo(
    () =>
      inputsUsable ? usdcPoolKey(token as Address, fee, tickSpacing, hooks as Address) : null,
    [inputsUsable, token, fee, tickSpacing, hooks],
  );
  const id = key ? poolId(key) : null;

  const reads = useReadContracts({
    contracts: onArc(id
      ? [
          { address: ARC.STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [id] },
          { address: ARC.STATE_VIEW, abi: stateViewAbi, functionName: "getLiquidity", args: [id] },
          { address: token as Address, abi: erc20Abi, functionName: "symbol" },
          FACTORY_ADDRESS
            ? {
                address: FACTORY_ADDRESS as Address,
                abi: factoryAbi,
                functionName: "vaultForPool",
                args: [id],
              }
            : { address: ARC.STATE_VIEW, abi: stateViewAbi, functionName: "getLiquidity", args: [id] },
        ]
      : []),
    query: { enabled: Boolean(id) },
  });

  const d = reads.data;
  const slot0 = d?.[0]?.status === "success" ? (d[0].result as [bigint, number, number, number]) : null;
  const liquidity = d?.[1]?.status === "success" ? (d[1].result as bigint) : 0n;
  const symbol = d?.[2]?.status === "success" ? (d[2].result as string) : null;
  const existing = d?.[3]?.status === "success" ? (d[3].result as Address) : zeroAddress;

  const initialized = Boolean(slot0 && slot0[0] > 0n);
  const alreadyListed = existing !== zeroAddress && isAddress(existing);
  const canCreate = Boolean(id) && initialized && !alreadyListed && Boolean(account);

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const create = () => {
    if (!key || !FACTORY_ADDRESS) return;
    writeContract({
      address: FACTORY_ADDRESS as Address,
      abi: factoryAbi,
      functionName: "createVault",
      args: [key],
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="label">Permissionless</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">List a pool</h1>
        <p className="mt-3 max-w-2xl text-[var(--color-muted)]">
          Anyone can create a vault for any USDC-quoted Uniswap v4 pool on Arc, and anyone can then
          stake in it. There is no allowlist and no approval step — the pool either meets the
          vault&apos;s requirements or it does not.{" "}
          <Link href="/docs/contracts#compatibility" className="text-[var(--color-accent)] underline">
            What qualifies
          </Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="panel space-y-5 p-6">
          <CardHeading title="Pool" subtitle="The USDC side is filled in for you." />

          <Field label="Token address" hint="The non-USDC side of the pair.">
            <input
              className="input mono"
              placeholder="0x…"
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              spellCheck={false}
            />
          </Field>

          <Field
            label="Hook address"
            hint="Launchpads deploy one hook per pool — read it from the pool's Initialize event. Leave as the zero address for a plain pool."
          >
            <input
              className="input mono"
              placeholder="0x0000000000000000000000000000000000000000"
              value={hooks}
              onChange={(e) => setHooks(e.target.value.trim())}
              spellCheck={false}
            />
          </Field>

          <Field label="Fee tier" hint="Must match the pool exactly, along with its tick spacing.">
            <div className="grid grid-cols-2 gap-2">
              {FEE_TIERS.map((t, i) => (
                <button
                  key={t.fee}
                  onClick={() => setTier(i)}
                  className={`rounded-lg border px-3 py-2 text-left text-[13px] transition ${
                    i === tier
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent-deep)]"
                      : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-dim)]"
                  }`}
                >
                  <span className="mono font-semibold">{t.label}</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--color-dim)]">
                    spacing {t.tickSpacing}
                  </span>
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="panel space-y-4 p-6">
          <CardHeading title="Check" subtitle="Runs before you spend gas on a transaction." />

          {problems.map((p) => (
            <Row key={p.code} tone="bad" title={p.code}>
              {p.detail}
            </Row>
          ))}

          {!token && problems.length === 0 && (
            <p className="text-[13px] text-[var(--color-muted)]">
              Enter a token address to check a pool.
            </p>
          )}

          {id && (
            <>
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                <div className="label">Pool id</div>
                <div className="mono mt-1 break-all text-[11px] text-[var(--color-muted)]">{id}</div>
              </div>

              {reads.isLoading ? (
                <p className="text-[13px] text-[var(--color-muted)]">Reading the pool…</p>
              ) : !initialized ? (
                <Row tone="bad" title="PoolNotInitialized">
                  No pool exists at this combination on {targetChain.name}. The token, fee tier, tick
                  spacing and hook must all match an existing pool exactly — one wrong field produces
                  a different pool id.
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
                        <span className="mono">{symbol}</span> / USDC, initialised and holding
                        liquidity.
                      </span>
                    ) : (
                      <>Initialised and holding liquidity.</>
                    )}
                  </Row>
                  <Row tone="good" title="Hook is exit-safe">
                    Carries no remove-liquidity permission and cannot return a delta on add or
                    remove, so it can never block or skim a withdrawal.
                  </Row>
                  {liquidity === 0n && (
                    <Row tone="warn" title="Pool has no liquidity">
                      A vault can still be created, but it will have nothing to earn from until
                      somebody provides liquidity to the pool itself.
                    </Row>
                  )}
                </>
              )}
            </>
          )}

          {receipt.isSuccess ? (
            <Row tone="good" title="Vault created">
              <Link href="/pools" className="underline">
                See it in the pool list
              </Link>
            </Row>
          ) : (
            <button className="btn btn-primary w-full" disabled={!canCreate || isPending || receipt.isLoading} onClick={create}>
              {!account
                ? "Connect a wallet to list"
                : isPending || receipt.isLoading
                  ? "Creating…"
                  : "Create vault"}
            </button>
          )}

          {writeError && (
            <p className="text-[12px] text-[var(--color-down)]">
              {writeError.message.split("\n")[0]}
            </p>
          )}

          <p className="text-[12px] leading-relaxed text-[var(--color-dim)]">
            Creating a vault costs gas and nothing else. It gives you no special rights over the
            vault — the owner and fee recipient are set by the factory, identically for every pool.
          </p>
        </div>
      </div>
    </div>
  );
}

function CardHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="mt-1 text-[13px] text-[var(--color-muted)]">{subtitle}</p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1.5">{children}</div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-dim)]">{hint}</p>
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
  // items-start, or the badge stretches to the height of the paragraph beside it: flex children
  // default to `stretch`, which turns a pill into a tall lozenge next to two lines of text.
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
