import { A, Callout, Code, H2, LI, P, Pre, Strong, UL, DocHeader } from "@/components/Prose";

export const metadata = { title: "The fee stream — Sluice on Arc" };

const ATTACK = `block N     attacker deposits a large amount
block N+1   attacker calls harvest() — a week of fees lands in NAV
block N+2   attacker withdraws, taking a share of fees earned
            over a week they were exposed to for two blocks`;

export default function FeeStreaming() {
  return (
    <>
      <DocHeader kicker="For holders" title="The fee stream" lede={"Why fees trickle out over a week instead of landing all at once — and why that choice protects you."} />
      <H2 id="problem">The problem it solves</H2>
      <P>
        Fees build up inside the Uniswap position continuously, but they are only{" "}
        <Strong>collected</Strong> when someone harvests. That makes a harvest a discrete jump: one
        moment the vault is worth X, the next it is worth X plus a week of trading fees.
      </P>
      <P>Anything that jumps can be front-run. Without a stream, the attack is trivial:</P>
      <Pre>{ATTACK}</Pre>
      <P>
        Every honest staker who held through that week just had their yield diluted by someone who
        took none of the risk.
      </P>

      <H2 id="solution">What the stream does</H2>
      <P>
        Harvested fees are not added to what shares are worth. They go into a{" "}
        <Strong>seven-day linear payout</Strong>, credited per second to whoever holds shares across
        that window.
      </P>
      <P>
        The attacker above now earns two blocks of a seven-day stream — effectively nothing — while
        carrying full price exposure for as long as they hold. To capture a real share they have to
        hold for a real duration, at which point they are simply a liquidity provider like everyone
        else.
      </P>
      <Callout tone="good" title="Tested, not assumed">
        <Code>test_lateDepositor_cannotSnipeAccruedFees</Code> deposits a large position after all
        the trading is done, withdraws immediately, and asserts the round trip extracted nothing
        meaningful from roughly 600 USDC of fees sitting unharvested.
      </Callout>

      <H2 id="harvest-first">Why every action harvests first</H2>
      <P>
        There is a subtler version of the same attack. In Uniswap v4, changing a position&apos;s
        liquidity <Strong>sweeps its entire accrued fee balance</Strong>, no matter how much
        liquidity you are adding or removing.
      </P>
      <P>
        A deposit that did not harvest first would have those fees quietly netted against what the
        depositor owed — handing one person everyone else&apos;s yield through the settlement path
        rather than the reward path.
      </P>
      <P>
        This was a real bug during development, worth <Strong>0.9 tokens per round trip</Strong> on
        a pool with 1M of depth. The fix is that deposits, withdrawals and compounds all harvest
        before touching liquidity, so there is never a pending balance sitting there to sweep.
      </P>
      <P>
        There is a second-order version too. When the vault swaps harvested fees through its own
        pool, that swap pays fees back to its own position — after the collection point. Those have
        to be swept as well, so internal swaps collect twice.
      </P>

      <H2 id="stacking">Overlapping harvests</H2>
      <P>
        If a harvest happens while a previous stream is still running, the two combine. Whatever is
        left of the old stream is folded into the new one and the seven-day clock restarts.
      </P>
      <UL>
        <LI>Frequent harvests produce a smooth, near-continuous payout.</LI>
        <LI>Rare harvests produce visible steps in the APR.</LI>
        <LI>Either way nothing is lost — only the timing of the payout changes.</LI>
      </UL>

      <H2 id="no-stakers">When nobody is staked</H2>
      <P>
        If a harvest lands while the vault has no shares outstanding, there is nobody to stream to.
        Rather than letting that value become permanently unclaimable, the whole harvest is routed
        into the compounding queue, where it becomes liquidity for whoever stakes next.
      </P>
      <P>
        <A href="/docs/security">How the rest of the safety model works →</A>
      </P>
    </>
  );
}
