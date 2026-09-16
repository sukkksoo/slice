import { A, Callout, H2, LI, P, Strong, UL, DocHeader } from "@/components/Prose";

export const metadata = { title: "What Sluice is — Sluice on Arc" };

export default function DocsIndex() {
  return (
    <>
      <DocHeader kicker="Docs" title="What Sluice is" />
      <P>
        Sluice is a liquidity layer for <A href="https://www.arc.io/">Arc</A>. It does two things,
        for two different groups of people, on top of the same piece of machinery.
      </P>
      <H2>For people holding tokens</H2>
      <P>
        Providing liquidity on a DEX earns you a cut of trading fees, but it is fiddly: you pick a
        price range, you hold a non-fungible position, you remember to collect. Sluice wraps all of
        that. You deposit into a pool&apos;s vault, you get fungible shares, and the fees that pool
        earns arrive as USDC.
      </P>
      <P>
        The yield is <Strong>real trading activity</Strong>, not token emissions. Nothing is minted
        to pay you. If the pool is busy you earn more; if it is quiet you earn less.
      </P>

      <H2>For people launching tokens</H2>
      <P>
        A token with thin liquidity trades badly, and deepening it by hand means remembering to do
        it. Sluice lets you point a <Strong>fee router</Strong> at your pool, fund it with USDC, and
        have it deploy that budget into liquidity automatically — on a timer, or as the token
        crosses market-cap milestones you pick in advance.
      </P>
      <P>
        Where the USDC comes from is up to you. A launchpad forwarding your fee share, a treasury
        wiring a budget, or a plain transfer all look identical to the router.
      </P>

      <H2>What it is built on</H2>
      <UL>
        <LI>
          <Strong>Uniswap v4</Strong> — every vault owns one full-range position in a real Uniswap
          pool. Sluice does not run its own AMM.
        </LI>
        <LI>
          <Strong>Arc</Strong> — Circle&apos;s stablecoin-native L1, where gas is paid in USDC and
          every token launches paired against it.
        </LI>
        <LI>
          <Strong>No custody by us</Strong> — vaults are contracts you interact with directly. Your
          shares are an ERC-20 you hold.
        </LI>
      </UL>

      <Callout tone="warn" title="Unaudited">
        These contracts hold funds and have had no third-party review. See{" "}
        <A href="/docs/risks">Risks</A> for what can go wrong — including the failure modes nothing
        on-chain can prevent.
      </Callout>

      <H2>Where to go next</H2>
      <UL>
        <LI>
          <A href="/docs/how-it-works">How it works</A> — the full path from a swap to your claim.
        </LI>
        <LI>
          <A href="/docs/staking">Staking liquidity</A> — depositing, withdrawing, what your shares
          represent.
        </LI>
        <LI>
          <A href="/docs/creator-routing">Fee routing</A> — the creator side, end to end.
        </LI>
        <LI>
          <A href="/docs/arc">Building on Arc</A> — what makes this chain different, and why the
          design responds to it.
        </LI>
      </UL>
    </>
  );
}
