import { A, Callout, Code, H2, H3, LI, P, Pre, Strong, Table, UL, DocHeader } from "@/components/Prose";

export const metadata = { title: "Fee routing — Slice on Arc" };

const FLOW = `USDC arrives (launchpad fees, treasury budget, plain transfer)
        │
        ▼
   FeeRouter ──── trigger met? ────► inject()
        │                              │
        │                              ▼
        │                    vault deposits it as liquidity
        │                              │
        │                              ▼
        └─ unspent budget stays    shares ──► burn address
           withdrawable by you              (liquidity is now permanent)`;

export default function CreatorRouting() {
  return (
    <>
      <DocHeader kicker="For creators" title="Fee routing" lede={"Turn a share of trading fees, or any USDC budget, into deeper liquidity for your token — automatically, on-chain, without running anything yourself."} />
      <H2 id="idea">The idea</H2>
      <P>
        A <Strong>fee router</Strong> is a contract you own that holds USDC and deploys it into your
        pool&apos;s liquidity when a condition you set is met.
      </P>
      <P>
        It does not care where the USDC comes from. A launchpad forwarding your fee share, a
        treasury wiring a monthly budget, or you sending some by hand all look the same to it. That
        is deliberate — capturing fees through a custom Uniswap hook would only have worked for
        pools deployed with that hook, which is almost none of them.
      </P>
      <Pre>{FLOW}</Pre>

      <H2 id="triggers">Two triggers</H2>
      <Table
        head={["Mode", "Fires when", "Typical use"]}
        rows={[
          [
            <Strong key="a">Cadence</Strong>,
            "A fixed interval has passed. Minimum one hour.",
            "Steady, predictable deepening — a drip your holders can verify.",
          ],
          [
            <Strong key="b">Milestone</Strong>,
            "Fully diluted market cap crosses each threshold you set, in order, once each.",
            "Committing publicly to add liquidity as the token grows.",
          ],
        ]}
      />
      <P>
        Each injection deploys a percentage of the router&apos;s current balance, so the budget
        tapers rather than emptying in one go. You can set a minimum size so gas never exceeds the
        amount being deployed.
      </P>

      <Callout title="Milestones are priced off a TWAP, never spot">
        If milestones read the instant price, anyone could push the price through a threshold inside
        a single block and force an injection at a moment of their choosing. Market cap is measured
        against the vault&apos;s time-weighted average instead, so an attacker would have to hold a
        dislocated price for the whole averaging window.
      </Callout>

      <H2 id="permanent">Permanent or redeemable</H2>
      <P>
        Every injection mints vault shares. Where those shares go is your choice, fixed when you
        create the router:
      </P>
      <UL>
        <LI>
          <Strong>Burn address</Strong> — the liquidity can never be withdrawn, by you or anyone
          else. This is the guarantee most holders actually want, and it is verifiable on-chain.
        </LI>
        <LI>
          <Strong>Your wallet</Strong> — the injected liquidity stays yours and remains redeemable.
        </LI>
      </UL>

      <H2 id="permissionless">Nobody has to run a keeper</H2>
      <P>
        <Code>inject()</Code> is callable by anyone. The trigger conditions decide whether it is
        valid, not the caller, and the destination is fixed at creation — so a stranger calling it
        cannot redirect anything. In practice this means the automation keeps working whether or not
        you are paying attention.
      </P>
      <P>
        Milestone mode does depend on the price oracle being fresh, which means someone has to call{" "}
        <Code>poke()</Code> from time to time. Any vault activity does this automatically.
      </P>

      <H2 id="steps">Setting one up</H2>
      <H3>1. Create the router</H3>
      <P>
        Pick your pool&apos;s vault and choose whether injections are permanent. This deploys a
        router that only you can configure.
      </P>
      <H3>2. Configure the trigger</H3>
      <P>
        Choose cadence or milestones, the share of budget per injection, and a minimum size. You can
        change this later.
      </P>
      <H3>3. Fund it</H3>
      <P>
        Send USDC to the router address, or call <Code>fund()</Code> to emit an event indexers can
        attribute. Then it runs.
      </P>
      <P>
        <A href="/creator">Set one up now →</A>
      </P>

      <Callout tone="warn" title="Unspent budget stays yours">
        You can withdraw an unspent balance at any time with <Code>sweep()</Code>. If you want to
        promise holders otherwise, fund the router from a contract that enforces the lock — and
        point injections at the burn address so whatever has already been deployed is permanent
        regardless.
      </Callout>
    </>
  );
}
