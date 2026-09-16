import { A, DocHeader, H2, P, Strong } from "@/components/Prose";

export const metadata = { title: "Plain English — Slice on Arc" };

/**
 * Every term the app uses that a newcomer would not already know.
 *
 * Written on the assumption that somebody has arrived from the app after meeting a word they did
 * not recognise, rather than that they are reading a textbook front to back. Each entry therefore
 * says what the thing is, and then why it matters *here* — a definition that leaves you no better
 * able to use the product has not earned its place.
 */

function Term({ word, also, children }: { word: string; also?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--color-border)] py-5 first:border-0 first:pt-0">
      <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
        {word}
        {also && <span className="ml-2 text-[13px] font-normal text-[var(--color-dim)]">{also}</span>}
      </h3>
      <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-[var(--color-muted)]">
        {children}
      </div>
    </div>
  );
}

export default function Glossary() {
  return (
    <>
      <DocHeader
        kicker="Start here"
        title="Plain English"
        lede="Every term this app uses that you would have no reason to already know, and why it matters here rather than in the abstract."
      />

      <H2 id="basics">The basics</H2>
      <div>
        <Term word="Liquidity" also="what you are providing">
          <P>
            A pool is a pile of two tokens that people trade against. Providing liquidity means
            adding to that pile. Traders pay a fee on every swap, and that fee is split between
            everyone who contributed — in proportion to how much of the pile is theirs.
          </P>
          <P>
            You are not lending and nobody is borrowing. You are the other side of other
            people&apos;s trades, and the fee is what you are paid for being there.
          </P>
        </Term>

        <Term word="LP" also="liquidity provider">
          <P>Someone providing liquidity. If you deposit here, that is you.</P>
        </Term>

        <Term word="Vault" also="what you actually deposit into">
          <P>
            One vault per pool. It holds a single liquidity position on your behalf, collects the
            fees, converts them to USDC and pays them out. You get{" "}
            <Strong>shares</Strong> in return, which are your claim on what it holds.
          </P>
          <P>
            The point of a vault is that collecting fees is otherwise manual work: you would have to
            call the pool yourself, pay gas, and end up holding whichever token the fees arrived in.
          </P>
        </Term>

        <Term word="Shares" also="sLP-SOMETHING">
          <P>
            Your receipt. Shares are an ordinary token, so they sit in your wallet and can be sent
            anywhere — and whoever holds them can withdraw the underlying liquidity.
          </P>
          <P>
            One caveat worth knowing: unclaimed rewards stay with whoever earned them, not with the
            shares. Sending shares does not send the USDC you have accrued.
          </P>
        </Term>
      </div>

      <H2 id="yield">Where the money comes from</H2>
      <div>
        <Term word="Swap fee" also="the source of everything">
          <P>
            A percentage of every trade, set by the pool, paid by the trader to the liquidity
            providers. A 1% pool takes 1% of each swap. That is the entire source of yield here —
            nothing is minted, nobody is diluted, and if the pool is quiet you earn little.
          </P>
        </Term>

        <Term word="Harvest">
          <P>
            Collecting the fees the position has accrued and starting to pay them out. Anyone can
            trigger it, and deposits and withdrawals do it automatically on the way through.
          </P>
        </Term>

        <Term word="Streaming" also="why rewards arrive gradually">
          <P>
            Harvested fees are paid out evenly over seven days rather than all at once. This is
            deliberate: paid instantly, somebody could deposit moments before a harvest, take a
            share of fees earned over days they were not present for, and leave. Streaming makes
            that cost a week of exposure, which is no longer free money.
          </P>
        </Term>

        <Term word="Compounding">
          <P>
            Instead of paying some harvested fees out, putting them back into the position as more
            liquidity. No new shares are created, so every existing share becomes worth slightly
            more.
          </P>
        </Term>

        <Term word="APR" also="and why it moves">
          <P>
            The current payout rate, annualised. It is arithmetic on what the pool earned recently,
            not a promise — a busy hour makes it read high and it decays as that week&apos;s stream
            unwinds. Treat it as a run-rate, not a rate of return.
          </P>
        </Term>
      </div>

      <H2 id="risk">What can go wrong</H2>
      <div>
        <Term word="Impermanent loss" also="the one that actually costs people money">
          <P>
            A liquidity position automatically sells the token as its price rises and buys as it
            falls. If the price moves a long way in either direction, you end up with less value
            than if you had simply held the two tokens — the fees you earned have to make up the
            difference.
          </P>
          <P>
            &quot;Impermanent&quot; is a misleading name: the loss only reverses if the price comes
            back. On a volatile token it can easily exceed everything you earn in fees. It is the
            main risk of providing liquidity anywhere, not something specific to this app.{" "}
            <A href="/docs/risks">More on risks</A>.
          </P>
        </Term>

        <Term word="Slippage">
          <P>
            The gap between the price you were quoted and the price you actually get, because the
            market moved in between. Every deposit and withdrawal here carries a minimum you are
            willing to accept; if reality comes in below it, the transaction reverts and you keep
            your money.
          </P>
        </Term>

        <Term word="Basis points" also="bps">
          <P>
            Hundredths of a percent. 100 bps is 1%, 50 bps is 0.5%. Used because &quot;a 0.5%
            increase on a 1% fee&quot; is ambiguous and &quot;50 bps&quot; is not.
          </P>
        </Term>
      </div>

      <H2 id="machinery">The machinery</H2>
      <div>
        <Term word="TWAP" also="time-weighted average price">
          <P>
            The average price over a window of time — here, thirty minutes. Used instead of the
            current price whenever the vault has to trade, because the current price can be pushed
            around within a single block by anyone willing to spend enough, while an average cannot
            be moved without holding the price there for the whole window.
          </P>
          <P>
            This is why a freshly listed pool takes about half an hour before single-sided deposits
            work: there is no way to have a thirty-minute average without thirty minutes.
          </P>
        </Term>

        <Term word="Price band" also="why a deposit is sometimes refused">
          <P>
            The vault only trades while the current price sits close to that average. If a token has
            just moved sharply the two diverge, the vault refuses to swap, and single-sided deposits
            pause until things settle. It is a deliberate refusal, not a fault — and two-sided
            deposits, withdrawals and claims never swap, so they are unaffected.
          </P>
        </Term>

        <Term word="Keeper">
          <P>
            Anything that calls the public maintenance functions: recording a price, harvesting,
            compounding. None of them can move money anywhere it was not already going, so anyone
            may run one. Slice runs one covering every pool.{" "}
            <A href="/docs/how-it-works#keepers">What it does</A>.
          </P>
        </Term>

        <Term word="Hook">
          <P>
            Extra code a Uniswap v4 pool can run on every trade — launchpads use them to take a cut.
            Slice refuses any pool whose hook could interfere with a withdrawal, because on a vault
            other people deposit into that is a trap rather than a fee.
          </P>
        </Term>

        <Term word="Full range">
          <P>
            The vault provides liquidity across every possible price rather than a narrow band. It
            earns less per pound than a tight range would while the price sits still, and never
            falls out of range and stops earning entirely — which a tight range does the moment the
            market leaves it.
          </P>
        </Term>

        <Term word="Tick spacing">
          <P>
            How finely a pool divides the price scale. It is part of a pool&apos;s identity, which is
            why the app reads it from the chain rather than asking you: two pools on the same token
            with different tick spacing are genuinely different pools.
          </P>
        </Term>

        <Term word="Permissionless">
          <P>
            Anyone can do it, and no one can stop them or is needed to approve it. Listing a pool
            and running a keeper are both permissionless here. It describes who may act — not
            whether anything needs doing.
          </P>
        </Term>
      </div>

      <H2 id="arc">On Arc specifically</H2>
      <div>
        <Term word="Gas">
          <P>
            The fee paid to the network to process a transaction — separate from anything Slice
            charges, and paid whether or not the transaction succeeds. On Arc it is paid in USDC,
            so you need a little USDC in your wallet to do anything at all.
          </P>
        </Term>

        <Term word="USDC" also="and its two forms on Arc">
          <P>
            A dollar-denominated stablecoin. Arc is unusual in that USDC is also the asset gas is
            paid in, which is why rewards here arrive as USDC rather than as a token you would have
            to sell.{" "}
            <A href="/docs/arc">More on Arc</A>.
          </P>
        </Term>
      </div>
    </>
  );
}
