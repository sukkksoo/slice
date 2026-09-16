"use client";

import { A, Callout, Code, H2, LI, P, Strong, Table, UL, DocHeader } from "@/components/Prose";
import { ARC, FACTORY_ADDRESS } from "@/lib/contracts";
import { useVaultAddresses } from "@/hooks/useVaults";
import { targetChain } from "@/lib/chain";
import { DEPLOYMENTS } from "@/lib/deployments";

function Addr({ value, explorer }: { value: string; explorer: string }) {
  return (
    <a
      href={`${explorer}/address/${value}`}
      target="_blank"
      rel="noreferrer"
      className="break-all font-mono text-[10px] text-[var(--color-accent)] hover:underline"
    >
      {value}
    </a>
  );
}

export default function Contracts() {
  const { addresses } = useVaultAddresses();
  const deployment = DEPLOYMENTS[targetChain.id];
  const explorer = targetChain.blockExplorers?.default.url ?? "";

  return (
    <>
      <DocHeader kicker="Reference" title="Contracts" />
      <P>
        Everything is deployed permissionlessly and verifiable on-chain. Currently targeting{" "}
        <Strong>{targetChain.name}</Strong> (chain {targetChain.id}).
      </P>
      <H2 id="delta">Slice contracts</H2>
      <Table
        head={["Contract", "Address", "Role"]}
        rows={[
          [
            <Strong key="a">VaultFactory</Strong>,
            <Addr key="a2" value={FACTORY_ADDRESS || "not deployed"} explorer={explorer} />,
            "Creates one vault per pool, keeps the registry, deploys fee routers.",
          ],
          [
            <Strong key="b">VaultDeployer</Strong>,
            <Addr key="b2" value={deployment?.vaultDeployer ?? "not deployed"} explorer={explorer} />,
            "Holds the vault creation bytecode so the factory stays under the 24KB contract size limit.",
          ],
        ]}
      />

      <H2 id="vaults">Live vaults</H2>
      {addresses.length === 0 ? (
        <P>No vaults deployed yet, or still loading from the chain.</P>
      ) : (
        <Table
          head={["#", "Vault"]}
          rows={addresses.map((a, i) => [
            String(i),
            <Addr key={a} value={a} explorer={explorer} />,
          ])}
        />
      )}

      <H2 id="arc">Arc and Uniswap</H2>
      <P>
        Slice only ever calls two of these at runtime: the Uniswap <Code>PoolManager</Code> and the
        USDC ERC-20 interface. Both carry identical bytecode on Arc mainnet and testnet.
      </P>
      <Table
        head={["Contract", "Address", "Used by Slice"]}
        rows={[
          [
            <Strong key="a">USDC (ERC-20)</Strong>,
            <Addr key="a2" value={ARC.USDC} explorer={explorer} />,
            "Yes — the reward and quote currency.",
          ],
          [
            <Strong key="b">Uniswap v4 PoolManager</Strong>,
            <Addr key="b2" value={ARC.POOL_MANAGER} explorer={explorer} />,
            "Yes — vaults hold liquidity here directly.",
          ],
          [
            <Strong key="c">StateView</Strong>,
            <Addr key="c2" value={ARC.STATE_VIEW} explorer={explorer} />,
            "No — reference only.",
          ],
          [
            <Strong key="d">PositionManager</Strong>,
            <Addr key="d2" value={ARC.POSITION_MANAGER} explorer={explorer} />,
            "No — mainnet only, absent on testnet.",
          ],
          [
            <Strong key="e">UniversalRouter</Strong>,
            <Addr key="e2" value={ARC.UNIVERSAL_ROUTER} explorer={explorer} />,
            "No — mainnet only, absent on testnet.",
          ],
        ]}
      />

      <H2 id="compatibility">Which pools Slice works with</H2>
      <P>
        Slice attaches to a <Strong>Uniswap v4 pool</Strong>, not to a launchpad. It does not care
        which platform created the token — if the launch put the token into a v4 pool quoted in
        USDC, a vault can be created for it permissionlessly. On Arc that covers most launchpads,
        because v4 plus USDC is the default shape.
      </P>
      <Table
        head={["Requirement", "Why"]}
        rows={[
          [
            <Strong key="a">A Uniswap v4 pool</Strong>,
            "Vaults hold liquidity in the PoolManager directly. A platform running its own AMM is not supported.",
          ],
          [
            <Strong key="b">Quoted in USDC</Strong>,
            "The 6-decimal ERC-20 at 0x3600…0000. Rewards are denominated in it, and native-currency pools are rejected.",
          ],
          [
            <Strong key="c">Already initialized</Strong>,
            "Otherwise the vault creator would get to pick the starting price on the first deposit.",
          ],
          [
            <Strong key="d">No exit-blocking hook</Strong>,
            "Rejected at creation if the hook can intercept a withdrawal — see below.",
          ],
        ]}
      />

      <H2 id="hooks">Hooks</H2>
      <P>
        v4 lets a pool attach a hook, and launchpads use them for taxes, fee splits and buybacks.
        Slice allows those. What it refuses is a hook that could stand between a staker and their
        money.
      </P>
      <P>
        A hook&apos;s permissions are encoded in the low bits of its address, so this is checkable
        before a vault ever holds anything. Vault creation reverts with{" "}
        <Code>HookMayBlockExit</Code> if the hook implements any remove-liquidity callback, or can
        return a delta on add or remove. Those could revert a withdrawal or skim it — on a vault
        other people deposit into, that is a trap rather than a fee.
      </P>
      <UL>
        <LI>
          <Strong>Allowed:</Strong> swap hooks — taxes, dynamic fees, dividends, buybacks. The worst
          they do is make the vault&apos;s own fee conversion less efficient.
        </LI>
        <LI>
          <Strong>Allowed:</Strong> hooks that gate <em>adding</em> liquidity. Deposits may fail,
          which is an annoyance, not a way to strand principal.
        </LI>
        <LI>
          <Strong>Refused:</Strong> anything that runs on removal, or returns a delta on add or
          remove.
        </LI>
      </UL>
      <Callout tone="warn" title="Check the pool before you deposit">
        The guard proves a hook cannot block your exit. It cannot tell you whether a token&apos;s
        tax makes the position unprofitable, or whether the team can mint more supply. Those are
        properties of the token, not of Slice.
      </Callout>

      <H2 id="permissions">What each role can do</H2>
      <UL>
        <LI>
          <Strong>Anyone</Strong> — create a vault for any USDC pool, create a fee router, poke,
          harvest, compound, collect protocol fees to the treasury, deposit, withdraw, claim.
        </LI>
        <LI>
          <Strong>Vault owner</Strong> — adjust the protocol fee (max 10%), the stream and compound
          split, and the price deviation band (max 5%). Cannot move user funds or pause anything.
        </LI>
        <LI>
          <Strong>Router creator</Strong> — configure triggers, change the injection recipient, and
          withdraw unspent budget. Cannot touch the vault or anyone else&apos;s position.
        </LI>
      </UL>

      <H2 id="source">Source</H2>
      <P>
        Contracts are written in Solidity 0.8.26 against Uniswap v4 core. See{" "}
        <A href="/docs/security">the security model</A> for the testing approach, including the fork
        suite that runs against live Arc.
      </P>
    </>
  );
}
