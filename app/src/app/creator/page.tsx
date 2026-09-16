"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { decodeEventLog, isAddress, parseUnits, zeroAddress } from "viem";
import { useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { NotDeployed } from "@/components/Empty";
import { Action, TxStatus, useAfterConfirm, useNetworkGuard } from "@/components/tx";
import { Badge, SectionHeading } from "@/components/ui";
import { useVaults } from "@/hooks/useVaults";
import { ARC, erc20Abi, FACTORY_ADDRESS, factoryAbi, routerAbi, onArc } from "@/lib/contracts";
import { formatUsd, shortAddress } from "@/lib/format";
import { explorerAddress } from "@/lib/tx";
import { targetChain } from "@/lib/chain";

const BURN = "0x000000000000000000000000000000000000dEaD" as Address;

/** Router reads in a fixed order, so the decoder can stay positional without magic numbers. */
const ROUTER_FIELDS = [
  "vault",
  "creator",
  "injectionRecipient",
  "mode",
  "intervalSeconds",
  "lastInjectionAt",
  "injectionBps",
  "minInjection",
  "nextMilestone",
  "milestoneCount",
  "injectable",
  "marketCap",
] as const;
type RouterField = (typeof ROUTER_FIELDS)[number];
const R = Object.fromEntries(ROUTER_FIELDS.map((f, i) => [f, i])) as Record<RouterField, number>;
const I_ROUTER_USDC = ROUTER_FIELDS.length;
const I_USER_ALLOWANCE = ROUTER_FIELDS.length + 1;

export default function CreatorPage() {
  const guard = useNetworkGuard();
  const account = guard.account;
  const { vaults, configured } = useVaults();

  const [selectedVault, setSelectedVault] = useState("");
  const [permanent, setPermanent] = useState(true);
  const [routerInput, setRouterInput] = useState("");

  const [intervalHours, setIntervalHours] = useState("24");
  const [injectionPercent, setInjectionPercent] = useState("25");
  const [minInjection, setMinInjection] = useState("100");
  const [milestones, setMilestones] = useState("1000000, 5000000, 25000000");
  const [fundInput, setFundInput] = useState("");

  const { writeContract, data: txHash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || receipt.isLoading;

  const router = isAddress(routerInput) ? (routerInput as Address) : null;
  const holder = account ?? zeroAddress;

  const reads = useReadContracts({
    contracts: onArc(router
      ? [
          ...ROUTER_FIELDS.map((functionName) => ({ address: router, abi: routerAbi, functionName })),
          { address: ARC.USDC, abi: erc20Abi, functionName: "balanceOf", args: [router] },
          { address: ARC.USDC, abi: erc20Abi, functionName: "allowance", args: [holder, router] },
        ]
      : []),
    query: { enabled: Boolean(router), refetchInterval: 12_000 },
  });
  const d = reads.data;
  const val = <T,>(i: number, fallback: T): T =>
    d?.[i]?.status === "success" ? (d[i]!.result as T) : fallback;

  const routerVault = val<Address>(R.vault, zeroAddress);
  const creator = val<Address>(R.creator, zeroAddress);
  const recipient = val<Address>(R.injectionRecipient, zeroAddress);
  const mode = Number(val<number | bigint>(R.mode, 0));
  const intervalSeconds = Number(val<number | bigint>(R.intervalSeconds, 0));
  const lastInjectionAt = Number(val<number | bigint>(R.lastInjectionAt, 0));
  const injectionBps = Number(val<number | bigint>(R.injectionBps, 0));
  const minInjectionOnChain = val<bigint>(R.minInjection, 0n);
  const nextMilestone = Number(val<bigint>(R.nextMilestone, 0n));
  const milestoneCount = Number(val<bigint>(R.milestoneCount, 0n));
  const [ready, injectAmount] = val<[boolean, bigint]>(R.injectable, [false, 0n]);
  const [capOk, marketCap] = val<[boolean, bigint]>(R.marketCap, [false, 0n]);
  const routerUsdc = val<bigint>(I_ROUTER_USDC, 0n);
  const allowance = account ? val<bigint>(I_USER_ALLOWANCE, 0n) : 0n;

  const routerLoaded = router !== null && routerVault !== zeroAddress;
  const isCreator = Boolean(account && creator !== zeroAddress && account.toLowerCase() === creator.toLowerCase());
  const permanentOnChain = recipient.toLowerCase() === BURN.toLowerCase();

  // The router address is emitted by the factory. Read it off the receipt and fill it in, so
  // nobody has to go and find it in a block explorer's log tab.
  useEffect(() => {
    const logs = receipt.data?.logs;
    if (!logs || routerInput) return;
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "RouterCreated") {
          const args = decoded.args as unknown as { router: Address };
          setRouterInput(args.router);
          return;
        }
      } catch {
        /* a log from another contract, or a different event */
      }
    }
  }, [receipt.data, routerInput]);

  const refresh = useCallback(() => {
    void reads.refetch();
  }, [reads]);
  useAfterConfirm(txHash, receipt.isSuccess, refresh);

  const send = (fn: () => void) => {
    reset();
    fn();
  };

  const percentBps = useMemo(() => {
    const p = Number(injectionPercent);
    return Number.isFinite(p) && p > 0 && p <= 100 ? Math.round(p * 100) : null;
  }, [injectionPercent]);
  const minInjectionRaw = useMemo(() => {
    try {
      return parseUnits(minInjection || "0", 6);
    } catch {
      return null;
    }
  }, [minInjection]);
  const fundAmount = useMemo(() => {
    try {
      return fundInput ? parseUnits(fundInput.replace(/,/g, ""), 6) : 0n;
    } catch {
      return 0n;
    }
  }, [fundInput]);

  if (!configured) return <NotDeployed />;

  const createRouter = () =>
    send(() =>
      writeContract({
        address: FACTORY_ADDRESS as Address,
        abi: factoryAbi,
        functionName: "createRouter",
        args: [selectedVault as Address, permanent ? BURN : (account as Address)],
      }),
    );

  const configureCadence = () => {
    if (!router || percentBps === null || minInjectionRaw === null) return;
    send(() =>
      writeContract({
        address: router,
        abi: routerAbi,
        functionName: "configureCadence",
        args: [Math.max(1, Number(intervalHours) || 0) * 3600, percentBps, minInjectionRaw],
      }),
    );
  };

  const configureMilestones = () => {
    if (!router || percentBps === null || minInjectionRaw === null) return;
    let parsed: bigint[];
    try {
      parsed = milestones
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseUnits(s, 6));
    } catch {
      return;
    }
    send(() =>
      writeContract({
        address: router,
        abi: routerAbi,
        functionName: "configureMilestones",
        args: [parsed, percentBps, minInjectionRaw],
      }),
    );
  };

  const approveFund = () =>
    router &&
    send(() =>
      writeContract({
        address: ARC.USDC,
        abi: erc20Abi,
        functionName: "approve",
        args: [router, fundAmount],
      }),
    );
  const fund = () =>
    router &&
    send(() =>
      writeContract({ address: router, abi: routerAbi, functionName: "fund", args: [fundAmount] }),
    );
  const inject = () =>
    router && send(() => writeContract({ address: router, abi: routerAbi, functionName: "inject" }));
  const sweep = () =>
    router &&
    account &&
    send(() =>
      writeContract({
        address: router,
        abi: routerAbi,
        functionName: "sweep",
        args: [account, routerUsdc],
      }),
    );

  const nextDue = lastInjectionAt + intervalSeconds;
  const dueIn = Math.max(0, nextDue - Math.floor(Date.now() / 1000));

  return (
    <div>
      <SectionHeading
        title="Creator"
        subtitle="Route a share of trading fees, or a manually funded USDC budget, into your pool's liquidity automatically. The router does not care where the USDC comes from — a launchpad forwarding fees and a treasury wiring a budget look identical to it."
        action={
          <Link href="/docs/creator-routing" className="btn btn-ghost">
            Read the guide
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <StepCard n="01" title="Create a router">
          <div className="space-y-4">
            <div>
              <label className="label mb-1.5 block">Vault</label>
              <select
                value={selectedVault}
                onChange={(e) => setSelectedVault(e.target.value)}
                className="input text-sm"
              >
                <option value="">Select a vault…</option>
                {vaults.map((v) => (
                  <option key={v.address} value={v.address}>
                    {v.symbol} / USDC — {shortAddress(v.address)}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-[var(--color-dim)]">
                Pool not listed?{" "}
                <Link href="/pools/new" className="text-[var(--color-accent)] hover:underline">
                  Create its vault first
                </Link>
                .
              </p>
            </div>

            <div className="space-y-2">
              <Choice
                checked={permanent}
                onSelect={() => setPermanent(true)}
                title="Permanent injection"
                body="Shares go to a burn address. The liquidity can never be withdrawn — by you or anyone. Verifiable on-chain, and the guarantee most holders want."
              />
              <Choice
                checked={!permanent}
                onSelect={() => setPermanent(false)}
                title="Redeemable"
                body="Shares go to your wallet, so injected liquidity stays withdrawable."
              />
            </div>

            <Action
              guard={guard}
              busy={busy}
              disabled={!account || !isAddress(selectedVault)}
              onClick={createRouter}
              label={account ? "Create router" : "Connect wallet"}
            />
          </div>
        </StepCard>

        <StepCard n="02" title="Configure the trigger">
          <div className="space-y-4">
            <Input
              label="Router address"
              placeholder="0x… fills in automatically after step 1"
              value={routerInput}
              onChange={setRouterInput}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="% of budget per injection"
                value={injectionPercent}
                onChange={setInjectionPercent}
                invalid={percentBps === null}
              />
              <Input
                label="Minimum (USDC)"
                value={minInjection}
                onChange={setMinInjection}
                invalid={minInjectionRaw === null}
              />
            </div>

            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <div className="text-[13px] font-semibold">Cadence</div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
                Inject on a fixed timer. Minimum one hour.
              </p>
              <div className="mt-3">
                <Input label="Interval (hours)" value={intervalHours} onChange={setIntervalHours} />
              </div>
              <div className="mt-3">
                <Action
                  guard={guard}
                  busy={busy}
                  disabled={!router || percentBps === null || minInjectionRaw === null}
                  onClick={configureCadence}
                  label="Set cadence mode"
                  variant="ghost"
                />
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <div className="text-[13px] font-semibold">Market-cap milestones</div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
                Inject as the token crosses each cap, in order, once each. Read from the
                vault&apos;s TWAP, never spot — so nobody can push the price through a threshold in
                one block to force an injection.
              </p>
              <div className="mt-3">
                <Input
                  label="Caps in USDC, ascending"
                  value={milestones}
                  onChange={setMilestones}
                />
              </div>
              <div className="mt-3">
                <Action
                  guard={guard}
                  busy={busy}
                  disabled={!router || percentBps === null || minInjectionRaw === null}
                  onClick={configureMilestones}
                  label="Set milestone mode"
                  variant="ghost"
                />
              </div>
            </div>
          </div>
        </StepCard>

        <StepCard n="03" title="Fund and run">
          {!router ? (
            <p className="text-[13px] leading-relaxed text-[var(--color-muted)]">
              Enter a router address in step 2 to see its budget, its trigger, and whether an
              injection is due.
            </p>
          ) : !routerLoaded ? (
            <p className="text-[13px] text-[var(--color-muted)]">
              {reads.isLoading ? "Reading the router…" : "No router at that address."}
            </p>
          ) : (
            <div className="space-y-4">
              <dl className="space-y-2 text-[13px]">
                <Row label="Budget held" value={formatUsd(routerUsdc)} strong />
                <Row
                  label="Mode"
                  value={mode === 0 ? `Cadence · every ${(intervalSeconds / 3600).toFixed(0)}h` : "Milestones"}
                />
                <Row label="Per injection" value={`${(injectionBps / 100).toFixed(0)}% · min ${formatUsd(minInjectionOnChain)}`} />
                {mode === 0 ? (
                  <Row
                    label="Next due"
                    value={lastInjectionAt === 0 ? "Now" : dueIn === 0 ? "Now" : `${Math.ceil(dueIn / 3600)}h`}
                  />
                ) : (
                  <>
                    <Row label="Milestone" value={`${Math.min(nextMilestone + 1, milestoneCount)} of ${milestoneCount}`} />
                    <Row label="Market cap (TWAP)" value={capOk ? formatUsd(marketCap) : "oracle warming"} />
                  </>
                )}
                <Row
                  label="Injected shares go to"
                  value={permanentOnChain ? "burn address · permanent" : shortAddress(recipient)}
                />
                <Row label="Creator" value={isCreator ? "you" : shortAddress(creator)} />
              </dl>

              <div className="flex items-center gap-2">
                <Badge tone={ready ? "up" : "neutral"}>
                  {ready ? `Injectable · ${formatUsd(injectAmount)}` : "Not due"}
                </Badge>
                <a
                  href={explorerAddress(router)}
                  target="_blank"
                  rel="noreferrer"
                  className="mono text-[11px] text-[var(--color-dim)] hover:text-[var(--color-muted)]"
                >
                  {shortAddress(router)} ↗
                </a>
              </div>

              <Action
                guard={guard}
                busy={busy}
                disabled={!ready}
                onClick={inject}
                label={ready ? `Inject ${formatUsd(injectAmount)}` : "Inject — not due yet"}
              />

              <div className="border-t border-[var(--color-border)] pt-4">
                <Input label="Fund with USDC" placeholder="0.00" value={fundInput} onChange={setFundInput} />
                <div className="mt-2">
                  {allowance < fundAmount ? (
                    <Action
                      guard={guard}
                      busy={busy}
                      disabled={fundAmount === 0n}
                      onClick={approveFund}
                      label={fundAmount > 0n ? `Approve ${formatUsd(fundAmount)}` : "Approve"}
                      variant="ghost"
                    />
                  ) : (
                    <Action
                      guard={guard}
                      busy={busy}
                      disabled={fundAmount === 0n}
                      onClick={fund}
                      label={fundAmount > 0n ? `Fund ${formatUsd(fundAmount)}` : "Fund"}
                      variant="ghost"
                    />
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-dim)]">
                  Anyone can fund a router; only the creator can take unspent budget back out.
                </p>
              </div>

              {isCreator && routerUsdc > 0n && (
                <Action
                  guard={guard}
                  busy={busy}
                  onClick={sweep}
                  label={`Sweep ${formatUsd(routerUsdc)} back to my wallet`}
                  variant="ghost"
                />
              )}
            </div>
          )}
        </StepCard>
      </div>

      <div className="mt-5">
        <TxStatus
          hash={txHash}
          isPending={isPending}
          isConfirming={receipt.isLoading}
          isSuccess={receipt.isSuccess}
          error={error}
        />
      </div>
    </div>
  );
}

function StepCard({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel-raised flex flex-col p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="num grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-dim)] text-xs font-semibold text-[var(--color-accent)]">
          {n}
        </span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Choice({
  checked,
  onSelect,
  title,
  body,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
        checked
          ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`grid size-3.5 place-items-center rounded-full border ${
            checked ? "border-[var(--color-accent)]" : "border-[var(--color-dim)]"
          }`}
        >
          {checked && <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />}
        </span>
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">{body}</p>
    </button>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div>
      <label className="label mb-1.5 block">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`input num text-sm ${invalid ? "border-[var(--color-danger)]" : ""}`}
      />
      {invalid && (
        <p className="mt-1 text-[11px] text-[var(--color-danger)]">
          {label.startsWith("%") ? "Enter a percentage between 0 and 100." : "Enter a valid amount."}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className={`num text-right ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
