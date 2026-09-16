import { A, Callout, Code, H2, H3, LI, P, Pre, Strong, Table, UL, DocHeader } from "@/components/Prose";

export const metadata = { title: "How it works — Sluice on Arc" };

export default function HowItWorks() {
  return (
    <>
      <DocHeader kicker="Docs" title="How it works" lede={"The full path a trading fee takes before it becomes something you can claim."} />
      <H2 id="the-vault">The vault</H2>
      <P>
        Each pool gets one vault. The vault owns a single <Strong>full-range</Strong> Uniswap v4
        position — liquidity spread across every possible price, so it never falls out of range and
        never needs rebalancing.
      </P>
      <P>
        When you deposit, the vault adds your tokens to that position and mints you ERC-20 shares.
        Your shares are a pro-rata claim on the whole position. If the position holds 100 USDC and
        100 tokens and you own 10% of the shares, you can withdraw 10 USDC and 10 tokens.
      </P>
      <Callout title="Why shares instead of the position NFT">
        Uniswap v4 positions are NFTs, and each one has its own price range. If the vault escrowed
        your NFT, working out your share of the fees would depend on the range you happened to pick.
        One vault-owned position with fungible shares keeps the maths simple and makes your stake
        transferable.
      </Callout>

      <H2 id="harvest">Harvesting</H2>
      <P>
        Trading fees accrue inside the Uniswap position. <Code>harvest()</Code> collects them. It is
        permissionless — anyone can call it, and it also runs automatically at the start of every
        deposit, withdrawal and compound.
      </P>
      <P>Fees arrive in both tokens. The vault splits them three ways:</P>
      <Table
        head={["Portion", "Where it goes"]}
        rows={[
          [<Strong key="a">Protocol fee</Strong>, "1% of the harvest, accrued for the treasury to collect separately."],
          [<Strong key="b">Stream share</Strong>, "Converted to USDC and paid out to stakers over seven days."],
          [<Strong key="c">Compound share</Strong>, "Queued, then added back as liquidity — raising every share's backing."],
        ]}
      />
      <P>
        The split between streaming and compounding is a per-vault setting. At the default of 100%
        streaming, everything goes to stakers as claimable USDC.
      </P>

      <H3 id="converting">Converting the token side</H3>
      <P>
        Half the fees arrive as the pool&apos;s token rather than USDC. The vault swaps that side
        into USDC through the same pool, so everything it pays out is denominated in one asset.
      </P>
      <P>
        That swap is bounded. The vault keeps its own time-weighted average price and refuses to
        trade if the current price has drifted too far from it. If the price looks manipulated — or
        if the vault has not gathered enough price history yet — it simply{" "}
        <Strong>defers the conversion</Strong> and tries again next time.
      </P>
      <Callout tone="good" title="Why deferring matters">
        Harvest sits on the deposit and withdrawal path. If it reverted whenever the price looked
        wrong, a volatile hour would freeze the vault and you could not get your money out.
        Deferring keeps withdrawals working no matter what the market does.
      </Callout>

      <H2 id="streaming">Streaming, not dumping</H2>
      <P>
        A harvest is a lump of value arriving at one instant. If it were added straight to what your
        shares are worth, anyone could deposit in the block before a harvest, withdraw in the block
        after, and walk off with fees earned during a week they were not there for.
      </P>
      <P>
        So the proceeds are paid out <Strong>linearly over seven days</Strong> instead. To capture a
        meaningful amount you have to actually hold the position for a meaningful time — which is
        the same thing honest liquidity providers are doing.
      </P>
      <Pre>{`deposit ──► shares ──► rewards accrue every second ──► claim()
                        │
                        └─ transferring shares carries your
                           unclaimed rewards with you, not them`}</Pre>

      <H2 id="compounding">Compounding</H2>
      <P>
        Whatever is not streamed goes into a queue. Calling <Code>compound()</Code> takes that USDC,
        swaps half into the token, and adds both sides back into the position as new liquidity.
      </P>
      <P>
        No new shares are minted, so the extra liquidity is spread across existing holders. Your
        share count stays the same; what each share is worth goes up.
      </P>

      <H2 id="keepers">Who runs it</H2>
      <P>
        Nobody has to. <Code>poke()</Code>, <Code>harvest()</Code>, <Code>compound()</Code> and{" "}
        <Code>collectProtocolFees()</Code> are all callable by anyone, and none of them let the
        caller redirect funds. They exist as buttons on every vault page.
      </P>
      <UL>
        <LI>
          <Code>poke()</Code> records a price observation — this is what keeps the price history
          alive so conversions can happen.
        </LI>
        <LI>
          <Code>harvest()</Code> collects fees and starts the stream.
        </LI>
        <LI>
          <Code>compound()</Code> turns the queue into liquidity.
        </LI>
      </UL>
      <P>
        In practice deposits and withdrawals trigger harvests on their own, so an active pool keeps
        itself current. <A href="/docs/fee-streaming">More on the stream →</A>
      </P>
    </>
  );
}
