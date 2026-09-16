import Link from "next/link";

export function NotDeployed() {
  return (
    <div className="panel px-6 py-10 text-center">
      <div className="text-sm font-semibold">No factory configured</div>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--color-muted)]">
        Deploy the contracts, then set <code className="text-[var(--color-text)]">NEXT_PUBLIC_FACTORY_ADDRESS</code>{" "}
        in the app environment. Until then there is nothing on-chain to read.
      </p>
      <pre className="mx-auto mt-4 max-w-lg overflow-x-auto rounded bg-[var(--color-panel-2)] px-4 py-3 text-left text-[11px] text-[var(--color-muted)]">
{`cd contracts
forge script script/Deploy.s.sol \
  --rpc-url $ARC_RPC_URL --broadcast`}
      </pre>
    </div>
  );
}

export function NoVaults() {
  return (
    <div className="panel px-6 py-10 text-center">
      <div className="text-sm font-semibold">No vaults yet</div>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--color-muted)]">
        Anyone can create the vault for a Uniswap v4 pool that quotes USDC. The pool has to be
        initialized first.
      </p>
      <Link
        href="/creator"
        className="mt-4 inline-block rounded bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-black"
      >
        Create a vault
      </Link>
    </div>
  );
}
