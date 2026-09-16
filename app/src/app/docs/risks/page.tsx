import { A, Callout, Code, H2, LI, P, Strong, UL } from "@/components/Prose";

export const metadata = { title: "Risks — Delta on Arc" };

export default function Risks() {
  return (
    <>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-accent)]">
        For holders
      </div>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Risks</h1>
      <P>
        An honest list. Some of these are ordinary DeFi risks, some are specific to Arc, and one of
        them has no technical mitigation at all.
      </P>

      <Callout tone="warn" title="Start here: this code is unaudited">
        No third party has reviewed these contracts. Development surfaced two fee-leak bugs and one
        bug that could have frozen every vault permanently. All three are fixed and covered by
        tests — but finding three real defects is evidence that more exist, not that the code is
        now clean. Do not deposit money you cannot afford to lose.
      </Callout>

      <H2 id="il">Impermanent loss</H2>
      <P>
        Your shares track a Uniswap position, so they behave like one. If the token&apos;s price
        moves substantially in either direction, the value of your position will be lower than if
        you had simply held the two assets separately. Fees offset this; they do not cancel it.
      </P>
      <P>
        This is not a flaw in Delta — it is what providing liquidity is. But it is the risk most
        likely to actually cost you money, and it is larger for volatile tokens than the fee yield
        usually looks.
      </P>

      <H2 id="blocklist">USDC can be frozen</H2>
      <P>
        Arc&apos;s USDC consults a compliance blocklist on every transfer, and Circle — not Delta,
        not you — decides who is on it. The protocol is built so that a blocked{" "}
        <Strong>treasury</Strong> or a blocked <Strong>staker</Strong> cannot affect anyone else:
        protocol fees are pulled rather than pushed, and payouts only ever go to the address the
        caller chose.
      </P>
      <P>
        But if a <Strong>vault address itself</Strong> were ever blocklisted, that vault&apos;s
        funds would be frozen and nothing on-chain could recover them. This is inherent to building
        on Arc&apos;s USDC and no contract design avoids it.
      </P>

      <H2 id="price-impact">Harvests move the price</H2>
      <P>
        Converting the token side of collected fees into USDC is a real swap on the pool, and
        liquidity providers bear its price impact. It is bounded by a deviation band and the amounts
        are small relative to pool depth, but it is not free — it is a small, recurring cost carried
        by stakers.
      </P>

      <H2 id="partial">Large deposits fill partially</H2>
      <P>
        A USDC-only deposit that would move the price past the safety band stops early and refunds
        the remainder. This is the guard working correctly, but it is surprising if you expect the
        full amount to deploy. Use the two-sided deposit, or split it up.
      </P>

      <H2 id="oracle">The oracle needs warming</H2>
      <P>
        Automated conversions need 30 minutes of accumulated price observations. Until that window
        fills, single-sided deposits and compounding revert, and harvests defer the token-side
        conversion rather than performing it.
      </P>
      <P>
        Deposits with both sides, withdrawals and claims are unaffected by design — those paths must
        never depend on a price opinion.
      </P>

      <H2 id="governance">Governance</H2>
      <P>
        Each vault has an owner who can change the protocol fee (capped at 10%), the stream and
        compound split, and the price deviation band. The owner <Strong>cannot</Strong> withdraw
        user funds, mint shares, or pause withdrawals — there is no such function.
      </P>
      <P>
        Still, an owner key is an owner key. Check who owns a vault before depositing into it; the{" "}
        <A href="/docs/contracts">contracts page</A> lists the current addresses.
      </P>

      <H2 id="dust">Small accounting residues</H2>
      <UL>
        <LI>
          Each harvest leaves a tiny token balance unconverted, because converting fees is itself a
          swap that earns the position a fee. It converges geometrically and is carried forward, not
          lost.
        </LI>
        <LI>
          The first deposit into a vault permanently locks 1,000 shares. This is a standard defence
          against share-price manipulation of later depositors.
        </LI>
      </UL>

      <H2 id="chain">Chain and dependency risk</H2>
      <P>
        Delta sits on Uniswap v4 and on Arc. A critical bug in either, or a chain-level failure,
        affects Delta regardless of how correct Delta&apos;s own code is.
      </P>
    </>
  );
}
