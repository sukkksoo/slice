"use client";

import { useState } from "react";
import type { Address } from "viem";
import { isAddress, parseUnits } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { NotDeployed } from "@/components/Empty";
import { useVaults } from "@/hooks/useVaults";
import { FACTORY_ADDRESS, factoryAbi, routerAbi } from "@/lib/contracts";
import { shortAddress } from "@/lib/format";

const BURN = "0x000000000000000000000000000000000000dEaD" as Address;

export default function CreatorPage() {
  const { address: account } = useAccount();
  const { vaults, configured } = useVaults();

  const [selectedVault, setSelectedVault] = useState<string>("");
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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Creator</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--color-muted)]">
          Route a share of trading fees, or a manually funded USDC budget, into your pool&apos;s
          liquidity automatically. The router does not care where the USDC comes from — a launchpad
          forwarding fees and a treasury wiring a budget look identical to it, so it works with any
          fee source on Arc.
        </p>
      </div>

      <section className="panel space-y-4 p-5">
        <div className="text-xs font-semibold">1 · Create a router</div>

        <div>
          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Vault</label>
          <select
            value={selectedVault}
            onChange={(e) => setSelectedVault(e.target.value)}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs outline-none focus:border-[var(--color-accent)]"
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
          <label className="flex items-start gap-2 text-[11px]">
            <input
              type="radio"
              checked={permanent}
              onChange={() => setPermanent(true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold">Permanent injection</span>
              <span className="block text-[var(--color-muted)]">
                Shares go to a burn address. The liquidity can never be withdrawn — by you or by
                anyone else. This is the guarantee most holders actually want.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[11px]">
            <input
              type="radio"
              checked={!permanent}
              onChange={() => setPermanent(false)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold">Redeemable</span>
              <span className="block text-[var(--color-muted)]">
                Shares go to your wallet, so the injected liquidity stays withdrawable.
              </span>
            </span>
          </label>
        </div>

        <button
          type="button"
          disabled={busy || !account || !isAddress(selectedVault)}
          onClick={createRouter}
          className="w-full rounded bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-black disabled:opacity-40"
        >
          {busy ? "Pending…" : account ? "Create router" : "Connect wallet"}
        </button>
      </section>

      <section className="panel space-y-4 p-5">
        <div className="text-xs font-semibold">2 · Configure the schedule</div>

        <Input
          label="Router address"
          placeholder="0x… (from the transaction above)"
          value={routerAddress}
          onChange={setRouterAddress}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Share of budget per injection (%)"
            value={injectionPercent}
            onChange={setInjectionPercent}
          />
          <Input label="Minimum injection (USDC)" value={minInjection} onChange={setMinInjection} />
        </div>

        <div className="grid gap-4 border-t border-[var(--color-border)] pt-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="text-[11px] font-semibold">Cadence</div>
            <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
              Inject on a fixed timer. Minimum interval is one hour.
            </p>
            <Input label="Interval (hours)" value={intervalHours} onChange={setIntervalHours} />
            <button
              type="button"
              disabled={busy || !isAddress(routerAddress)}
              onClick={configureCadence}
              className="w-full rounded border border-[var(--color-border)] px-4 py-2 text-xs font-semibold hover:border-[var(--color-accent)] disabled:opacity-40"
            >
              Set cadence mode
            </button>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] font-semibold">Market-cap milestones</div>
            <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
              Inject as the token crosses each cap, in order, once each. Caps are read from the
              vault&apos;s TWAP rather than spot, so nobody can push the price through a threshold
              inside one block to force an injection.
            </p>
            <Input
              label="Caps in USDC, ascending, comma-separated"
              value={milestones}
              onChange={setMilestones}
            />
            <button
              type="button"
              disabled={busy || !isAddress(routerAddress)}
              onClick={configureMilestones}
              className="w-full rounded border border-[var(--color-border)] px-4 py-2 text-xs font-semibold hover:border-[var(--color-accent)] disabled:opacity-40"
            >
              Set milestone mode
            </button>
          </div>
        </div>
      </section>

      <section className="panel space-y-2 p-5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        <div className="text-xs font-semibold text-[var(--color-text)]">3 · Fund it</div>
        <p>
          Send USDC to the router address, or call <code className="text-[var(--color-text)]">fund()</code>{" "}
          for an attributable event. Then anyone can call{" "}
          <code className="text-[var(--color-text)]">inject()</code> once the trigger is met — the
          conditions decide, not the caller, so you do not have to run a keeper yourself for it to
          work.
        </p>
        <p>
          Unspent budget stays withdrawable by you via{" "}
          <code className="text-[var(--color-text)]">sweep()</code>. If you want to promise
          otherwise, fund from a contract that enforces the lock and point injections at the burn
          address so deployed liquidity is permanent regardless.
        </p>
      </section>

      {error && (
        <div className="panel border-[var(--color-danger)] px-4 py-3 text-[11px] text-[var(--color-danger)]">
          {error.message.split("\n")[0]}
        </div>
      )}
      {receipt.isSuccess && (
        <div className="panel border-[var(--color-accent)] px-4 py-3 text-[11px] text-[var(--color-accent)]">
          Confirmed. Check the transaction logs for the router address.
        </div>
      )}
    </div>
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
      <label className="mb-1 block text-[11px] text-[var(--color-muted)]">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="num w-full rounded border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs outline-none focus:border-[var(--color-accent)]"
      />
    </div>
  );
}
