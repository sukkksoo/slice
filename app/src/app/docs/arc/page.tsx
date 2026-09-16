import { A, Callout, Code, H2, LI, P, Pre, Strong, Table, UL, DocHeader } from "@/components/Prose";

export const metadata = { title: "Building on Arc — Delta on Arc" };

const USDC = `native gas token   18 decimals   — what you pay gas in
ERC-20 interface    6 decimals   — 0x3600...0000

   same balance, two precisions.
   the gap between them is exactly 1e12.`;

export default function ArcPage() {
  return (
    <>
      <DocHeader kicker="Reference" title="Building on Arc" lede={"Arc is not a generic EVM chain. Four of its properties shaped this protocol, and two of them are genuine traps."} />
      <H2 id="gas">Gas is USDC</H2>
      <P>
        Arc is Circle&apos;s stablecoin-native L1. Transaction fees are denominated in USDC rather
        than a volatile gas token, blocks are about half a second, and finality is deterministic.
      </P>
      <P>
        For a liquidity protocol this is unusually convenient: the thing users pay gas in, the thing
        every token is paired against, and the thing fees are paid out in are all the same asset.
      </P>

      <H2 id="decimals">USDC has two representations</H2>
      <P>
        The native asset carries <Strong>18 decimals</Strong>. The canonical ERC-20 interface
        exposes the <Strong>same balance</Strong> with <Strong>6</Strong>.
      </P>
      <Pre>{USDC}</Pre>
      <Callout tone="warn" title="This is a 1,000,000,000,000x bug waiting to happen">
        Mixing the two representations silently produces a number off by twelve orders of magnitude.
        Delta sidesteps it entirely by rejecting native-currency pools: Arc&apos;s Uniswap pools
        quote against the 6-decimal ERC-20 anyway, so supporting both would put a scale factor on
        every accounting path for no benefit.
      </Callout>

      <H2 id="no-weth">There is no WETH</H2>
      <P>
        Delta on Robinhood Chain streams its fee rewards in WETH. Arc has no wrapped ether at all,
        so this implementation streams in USDC instead — which is also what every token pairs
        against, making it the natural denominator rather than a compromise.
      </P>

      <H2 id="precompiles">USDC is not an ordinary ERC-20</H2>
      <P>
        This one is only visible if you look. Arc&apos;s USDC is a thin wrapper over two chain
        precompiles:
      </P>
      <Table
        head={["Precompile", "Role"]}
        rows={[
          [<Code key="a">0x1800…0001</Code>, "Compliance check — isBlocklisted(address), consulted on every transfer."],
          [<Code key="b">0x1800…0000</Code>, "The actual native balance move, including the 6-to-18 decimal conversion."],
        ]}
      />
      <P>Two consequences follow, and both are load-bearing.</P>
      <UL>
        <LI>
          <Strong>Transfers revert for blocklisted parties.</Strong> Any USDC push sitting on a
          shared code path is therefore a freeze vector controlled by a third party. This is why
          protocol fees are pulled, not pushed — see <A href="/docs/security">Security</A>.
        </LI>
        <LI>
          <Strong>USDC cannot execute a transfer inside a Foundry fork.</Strong> The precompiles have
          no implementation in the local EVM, so a forked test that moves USDC dies with a stack
          underflow. Tooling that simulates locally before broadcasting — including{" "}
          <Code>forge script</Code> — cannot run any flow that touches it.
        </LI>
      </UL>

      <H2 id="v4">Uniswap v4, with no oracle</H2>
      <P>
        Uniswap v2, v3, v4 and UniswapX are all live on Arc. v4 moved price oracles out of the core
        pool and into hooks, which means a protocol operating on pools it does not own has no oracle
        available to it.
      </P>
      <P>
        Delta therefore accumulates its own. Every permissionless <Code>poke()</Code> records a
        time-weighted observation; automated swaps require both a long enough window and that the
        spot price has not diverged from the average. An attacker has to hold a dislocated price
        across the entire window, not for a single block.
      </P>

      <H2 id="testnet">Testnet differs from mainnet</H2>
      <P>
        The Uniswap <Code>PoolManager</Code> and the USDC interface sit at identical addresses on
        both networks. <Code>PositionManager</Code> and <Code>UniversalRouter</Code> do not — they
        have no code at their mainnet addresses on testnet. Delta calls neither, but do not assume
        an address resolves just because it does on mainnet.
      </P>
    </>
  );
}
