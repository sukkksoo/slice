import Link from "next/link";

function Shell({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel-raised px-6 py-14 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-accent-dim)] text-xl">
        {icon}
      </div>
      <h2 className="mt-5 text-lg font-semibold">{title}</h2>
      <div className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--color-muted)]">
        {children}
      </div>
    </div>
  );
}

export function NotDeployed() {
  return (
    <Shell icon="⚙" title="No factory configured">
      <p>
        Deploy the contracts, then set{" "}
        <code className="mono rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-xs text-[var(--color-text)]">
          NEXT_PUBLIC_FACTORY_ADDRESS
        </code>
        . Until then there is nothing on-chain to read.
      </p>
      <pre className="mono mt-5 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3.5 text-left text-xs text-[var(--color-muted)]">
        {`cd contracts\nforge script script/Deploy.s.sol \\\n  --rpc-url $ARC_RPC_URL --broadcast`}
      </pre>
    </Shell>
  );
}

export function NoVaults() {
  return (
    <Shell icon="◎" title="No vaults yet">
      <p>
        Anyone can create the vault for a Uniswap v4 pool that quotes USDC. The pool has to be
        initialized first.
      </p>
      <Link href="/creator" className="btn btn-primary mt-6">
        Create a vault
      </Link>
    </Shell>
  );
}

export function NothingStaked() {
  return (
    <Shell icon="◇" title="Nothing staked yet">
      <p>Deposit into a pool to start earning a share of its trading fees, paid in USDC.</p>
      <Link href="/pools" className="btn btn-primary mt-6">
        Browse pools
      </Link>
    </Shell>
  );
}

export function ConnectPrompt() {
  return (
    <Shell icon="⬡" title="Connect your wallet">
      <p>Your staked positions and claimable rewards will appear here.</p>
    </Shell>
  );
}
