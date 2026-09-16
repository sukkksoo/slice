"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { isAddress, parseUnits } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { NotDeployed } from "@/components/Empty";
import { SectionHeading } from "@/components/ui";
import { useVaults } from "@/hooks/useVaults";
import { FACTORY_ADDRESS, factoryAbi, routerAbi } from "@/lib/contracts";
import { shortAddress } from "@/lib/format";

const BURN = "0x000000000000000000000000000000000000dEaD" as Address;

export default function CreatorPage() {
  const { address: account } = useAccount();
  const { vaults, configured } = useVaults();

  const [selectedVault, setSelectedVault] = useState("");
  const [permanent, setPermanent] = useState(true);
  const [routerAddress, setRouterAddress] = useState("");

  const [intervalHours, setIntervalHours] = useState("24");
  const [injectionPercent, setInjectionPercent] = useState("25");
  const [minInjection, setMinInjection] = useState("100");
  const [milestones, setMilestones] = useState("1000000, 5000000, 25000000");

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || receipt.isLoading;

  if (!configured) return <NotDeployed />;

  const createRouter = () => {
    if (!isAddress(selectedVault)) return;
    writeContract({
      address: FACTORY_ADDRESS as Address,
      abi: factoryAbi,
      functionName: "createRouter",
      args: [selectedVault as Address, permanent ? BURN : (account as Address)],
    });
  };

  const configureCadence = () => {
    if (!isAddress(routerAddress)) return;
    writeContract({
      address: routerAddress as Address,
      abi: routerAbi,
      functionName: "configureCadence",
      args: [
        Math.max(1, Number(intervalHours)) * 3600,
        Math.round(Number(injectionPercent) * 100),
        parseUnits(minInjection || "0", 6),
      ],
    });
  };

  const configureMilestones = () => {
    if (!isAddress(routerAddress)) return;
    const parsed = milestones
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseUnits(s, 6));

    writeContract({
      address: routerAddress as Address,
      abi: routerAbi,
      functionName: "configureMilestones",
      args: [parsed, Math.round(Number(injectionPercent) * 100), parseUnits(minInjection || "0", 6)],
    });
  };

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

            <button
              type="button"
              disabled={busy || !account || !isAddress(selectedVault)}
              onClick={createRouter}
              className="btn btn-primary w-full"
            >
              {busy ? "Pending…" : account ? "Create router" : "Connect wallet"}
            </button>
          </div>
        </StepCard>

        <StepCard n="02" title="Configure the trigger">
          <div className="space-y-4">
            <Input
              label="Router address"
              placeholder="0x… from the transaction above"
              value={routerAddress}
              onChange={setRouterAddress}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="% of budget per injection"
                value={injectionPercent}
                onChange={setInjectionPercent}
              />
              <Input label="Minimum (USDC)" value={minInjection} onChange={setMinInjection} />
            </div>

            <div className="rounded-xl border border-[var(--color-border)] p-4">
              <div className="text-[13px] font-semibold">Cadence</div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
                Inject on a fixed timer. Minimum one hour.
              </p>
              <div className="mt-3">
                <Input label="Interval (hours)" value={intervalHours} onChange={setIntervalHours} />
              </div>
              <button
                type="button"
                disabled={busy || !isAddress(routerAddress)}
                onClick={configureCadence}
                className="btn btn-ghost mt-3 w-full"
              >
                Set cadence mode
              </button>
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
              <button
                type="button"
                disabled={busy || !isAddress(routerAddress)}
                onClick={configureMilestones}
                className="btn btn-ghost mt-3 w-full"
              >
                Set milestone mode
              </button>
            </div>
          </div>
        </StepCard>

        <StepCard n="03" title="Fund it">
          <div className="space-y-4 text-[13px] leading-relaxed text-[var(--color-muted)]">
            <p>
              Send USDC to the router address, or call{" "}
              <Code>fund()</Code> for an attributable event.
            </p>
            <p>
              Then anyone can call <Code>inject()</Code> once the trigger is met. The conditions
              decide validity, not the caller — so the automation keeps working whether or not you
              are watching, and you never have to run a keeper.
            </p>
            <div className="rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-dim)] p-4">
              <div className="text-[13px] font-semibold text-[var(--color-warn)]">
                Unspent budget stays yours
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
                You can withdraw it any time with <Code>sweep()</Code>. To promise holders
                otherwise, fund from a contract that enforces the lock — and point injections at the
                burn address so what is already deployed is permanent regardless.
              </p>
            </div>
          </div>
        </StepCard>
      </div>

      {error && (
        <div className="panel mt-5 border-[var(--color-danger)] px-5 py-4 text-[13px] text-[var(--color-danger)]">
          {error.message.split("\n")[0]}
        </div>
      )}
      {receipt.isSuccess && (
        <div className="panel mt-5 border-[var(--color-accent)] px-5 py-4 text-[13px] text-[var(--color-accent)]">
          Confirmed. Check the transaction logs for the router address.
        </div>
      )}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label mb-1.5 block">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input num text-sm"
      />
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="mono rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[11px] text-[var(--color-text)]">
      {children}
    </code>
  );
}
