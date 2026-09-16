import { A, Callout, Code, H2, LI, P, Strong, Table, UL, DocHeader } from "@/components/Prose";

export const metadata = { title: "Staking liquidity — Sluice on Arc" };

export default function Staking() {
  return (
    <>
      <DocHeader kicker="For holders" title="Staking liquidity" lede={"What you put in, what you get back, and what can change in between."} />
      <H2 id="depositing">Two ways to deposit</H2>
      <Table
        head={["Method", "What happens", "When to use it"]}
        rows={[
          [
            <Strong key="a">USDC only</Strong>,
            "The vault swaps half your USDC into the token, then adds both sides in one transaction.",
            "You hold USDC and just want exposure to the fees.",
          ],
          [
            <Strong key="b">Both sides</Strong>,
            "You supply USDC and the token yourself. Nothing is swapped.",
            "You already hold the token, or the price band is blocking single-sided entry.",
          ],
        ]}
      />
      <P>
        Either way, anything the position cannot absorb at the current ratio is{" "}
        <Strong>refunded in the same transaction</Strong>. You are never left with a stranded
        balance inside the vault.
      </P>

      <Callout tone="warn" title="Large single-sided deposits fill partially">
        The vault refuses to move the price further than its safety band allows. A USDC-only deposit
        worth a few percent of the pool&apos;s depth will hit that limit part-way through, deploy
        what it can, and refund the rest. In testing, a deposit worth around 2.5% of pool depth
        deployed about 81%; one worth 0.2% deployed 99.9%. Split large deposits, or use the
        two-sided method.
      </Callout>

      <H2 id="shares">What your shares represent</H2>
      <P>
        Shares are a plain ERC-20. They are a claim on a fraction of the vault&apos;s Uniswap
        position — not a fixed amount of either token.
      </P>
      <P>
        That means your balance shifts with the price, exactly as it would if you held the position
        yourself. If the token rises against USDC, your position ends up holding more USDC and less
        of the token. This is ordinary automated-market-maker behaviour, usually called{" "}
        <Strong>impermanent loss</Strong>, and it applies here in full. Sluice does not hedge it.
      </P>
      <UL>
        <LI>Shares are transferable — sending them moves the underlying claim.</LI>
        <LI>
          Your <Strong>unclaimed rewards do not move with them</Strong>. They stay with whoever
          earned them.
        </LI>
        <LI>There is no lockup. Withdraw whenever you like.</LI>
      </UL>

      <H2 id="rewards">Claiming</H2>
      <P>
        Rewards accrue in USDC, every second, based on how many shares you hold and how long you
        hold them. They sit in the vault until you call <Code>claim()</Code>; there is no deadline
        and no penalty for leaving them there.
      </P>
      <P>
        Claiming is separate from withdrawing. You can take your rewards and stay staked, or
        withdraw your position and claim afterwards.
      </P>

      <H2 id="withdrawing">Withdrawing</H2>
      <P>
        Burning shares removes the matching slice of liquidity and returns both tokens. The vault
        harvests first, so any fees the position had accrued go to the stream rather than to whoever
        happens to withdraw next.
      </P>
      <P>
        Withdrawals keep working even when the price oracle is cold or the market is moving
        violently. That was a deliberate design constraint, not an accident.{" "}
        <A href="/docs/security">More on that →</A>
      </P>

      <H2 id="apr">Reading the APR</H2>
      <P>
        The APR on the pools table annualises the <Strong>current</Strong> payout rate. It is a
        run-rate, not a realised return, and it is volatile by construction: it jumps after a busy
        hour and decays as the seven-day stream unwinds.
      </P>
      <P>Treat it as a snapshot of recent trading activity, not a promise about the next year.</P>
    </>
  );
}
