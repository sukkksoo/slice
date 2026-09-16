import { A, Callout, Code, H2, H3, LI, P, Strong, Table, UL } from "@/components/Prose";

export const metadata = { title: "Security model — Delta on Arc" };

export default function Security() {
  return (
    <>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-accent)]">Reference</div>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Security model</h1>
      <P>
        What the protocol defends against, how, and — just as importantly — the bugs that were found
        while building it.
      </P>

      <Callout tone="warn" title="Unaudited">
        Everything below describes intent and testing, not third-party verification.{" "}
        <A href="/docs/risks">Read the risks →</A>
      </Callout>

      <H2 id="properties">The properties that must hold</H2>
      <Table
        head={["Property", "How it is enforced"]}
        rows={[
          [
            <Strong key="a">Withdrawals never freeze</Strong>,
            "Nothing on the withdrawal path can be made to revert by a third party. Fee conversion degrades to deferral; protocol fees are pulled, not pushed.",
          ],
          [
            <Strong key="b">You cannot capture fees you did not earn</Strong>,
            "Harvests stream over seven days, and every liquidity change harvests first so there is no pending balance to sweep.",
          ],
          [
            <Strong key="c">Automated swaps cannot be price-manipulated</Strong>,
            "Every internal swap requires a 30-minute TWAP window and rejects a spot price that has diverged from it.",
          ],
          [
            <Strong key="d">The owner cannot take your money</Strong>,
            "There is no function that withdraws user funds, mints shares, or pauses withdrawals. Parameters are bounded in the contract.",
          ],
        ]}
      />

      <H2 id="bugs">Bugs found during development</H2>
      <P>
        These are documented because a protocol&apos;s bug history tells you more about its risk
        than its feature list does.
      </P>

      <H3>1. Depositors could sweep pending fees</H3>
      <P>
        In Uniswap v4, changing a position&apos;s liquidity collects its{" "}
        <Strong>entire accrued fee balance</Strong> regardless of the size of the change. A deposit
        that did not harvest first had those fees netted against its own settlement — silently
        transferring other stakers&apos; yield to whoever deposited next.
      </P>
      <P>
        Caught by a test asserting a late depositor cannot profit from a round trip. Worth{" "}
        <Strong>0.9 tokens per round trip</Strong> on a pool with 1M of depth. Fixed by harvesting
        before every liquidity change.
      </P>

      <H3>2. The same bug, one level down</H3>
      <P>
        When the vault swaps harvested fees through its own pool, that swap pays liquidity fees back
        to its own position — <Strong>after</Strong> the collection point. Those sat uncollected
        until the next deposit swept them. Fixed by collecting a second time after any internal
        swap.
      </P>

      <H3>3. A blocklisted treasury could have frozen every vault</H3>
      <P>
        This is the serious one. <Code>harvest()</Code> originally pushed the protocol fee to the
        treasury, and <Code>harvest()</Code> runs at the start of every deposit, withdrawal and
        compound. Arc&apos;s USDC reverts for a blocklisted address.
      </P>
      <P>
        So if Circle had ever blocklisted the treasury address, <Strong>every vault would have
        frozen permanently — withdrawals included</Strong>. A total loss of user funds, triggerable
        by a third party, against an address the vault does not control.
      </P>
      <P>
        Found by running the test suite against a fork of the real Arc chain rather than a local
        fixture. Fixed by accruing fees and having the treasury pull them with{" "}
        <Code>collectProtocolFees()</Code>, so a blocked treasury only fails its own collection.
      </P>
      <Callout tone="good" title="The general rule this produced">
        Never push a token transfer on a code path that users depend on for exit. If a third party
        can make any transfer revert, and that transfer sits on the withdrawal path, they can freeze
        the protocol.
      </Callout>

      <H2 id="testing">How it is tested</H2>
      <UL>
        <LI>
          <Strong>79 tests</Strong>, with the core suites run twice — once for each ordering of the
          token pair, since roughly half the branches depend on which side USDC sorts to.
        </LI>
        <LI>
          <Strong>Fork tests against live Arc</Strong>, using the real Uniswap PoolManager and the
          real USDC contract. This is what caught the freeze bug.
        </LI>
        <LI>
          <Strong>Property fuzzing</Strong> at 100,000 runs on the invariant that a deposit and
          withdrawal round trip can never return more than it took in.
        </LI>
        <LI>
          <Strong>A blocklist simulation</Strong> reproducing Arc&apos;s USDC behaviour offline, so
          freeze-resistance is a permanent regression test rather than a one-off check.
        </LI>
      </UL>

      <H2 id="scope">What is deliberately out of scope</H2>
      <UL>
        <LI>
          <Strong>Impermanent loss.</Strong> Not hedged. Full AMM exposure, by design.
        </LI>
        <LI>
          <Strong>A blocklisted vault.</Strong> Unrecoverable, and no contract design prevents it.
        </LI>
        <LI>
          <Strong>Chain or Uniswap failure.</Strong> Outside anything Delta can control.
        </LI>
      </UL>
    </>
  );
}
