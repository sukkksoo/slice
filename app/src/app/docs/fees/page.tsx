import { A, Callout, Code, DocHeader, H2, LI, P, Strong, Table, UL } from "@/components/Prose";

export const metadata = { title: "Fees — Slice on Arc" };

export default function Fees() {
  return (
    <>
      <DocHeader
        kicker="For holders"
        title="Fees"
        lede="Every charge the protocol makes, what it is taken from, and where it goes."
      />

      <Callout tone="warn" title="There is an entry fee">
        Slice charges <Strong>5% on deposit</Strong>. It comes out of the principal you supply, not
        out of yield — so depositing 100 USDC puts roughly 95 USDC of position to work. Read this
        page before staking.
      </Callout>

      <H2 id="entry">Entry fee — 5% of every deposit</H2>
      <P>
        Charged on the tokens you supply, before any liquidity is added. Your shares are minted
        against the net amount, so the position you hold reflects what actually went in.
      </P>
      <P>
        This is a <Strong>haircut on principal</Strong>, which makes it different in kind from the
        other charges below. Those take a slice of yield as it is produced; this one reduces your
        stake up front. It does not decay, and it is not recovered when you withdraw — you have to
        earn it back through fees before you are level.
      </P>
      <P>
        At the current rate, a position needs to accrue 5% of its value in streamed fees before it
        breaks even against simply not depositing. How long that takes depends entirely on how much
        the pool trades.
      </P>
      <UL>
        <LI>
          Capped in the contract at <Code>MAX_DEPOSIT_FEE_BPS</Code> = 10%, so it cannot be raised
          without limit on people already staked.
        </LI>
        <LI>
          Readable on-chain at any time via <Code>depositFeeBps()</Code>, and shown in the deposit
          panel before you confirm.
        </LI>
        <LI>
          Accrued rather than pushed, and collected separately with{" "}
          <Code>collectDepositFees()</Code>. That is a safety property, not a courtesy — see below.
        </LI>
      </UL>

      <H2 id="all">Every charge, side by side</H2>
      <Table
        head={["Charge", "Rate", "Taken from", "Goes to"]}
        rows={[
          [
            <Strong key="a">Entry fee</Strong>,
            "5%",
            "Your principal, on deposit",
            "feeRecipient",
          ],
          [
            <Strong key="b">Protocol fee</Strong>,
            "1%",
            "Each harvest of trading fees",
            "treasury",
          ],
          [
            <Strong key="c">Pool swap fee</Strong>,
            "Set by the pool",
            "Traders, not stakers",
            "Liquidity providers — you",
          ],
          [
            <Strong key="d">Exit fee</Strong>,
            "None",
            "—",
            "—",
          ],
        ]}
      />
      <P>
        There is no withdrawal fee and no lockup. The pool&apos;s own swap fee is not a cost to you
        at all — it is the thing you are earning.
      </P>

      <H2 id="why-pull">Why fees are collected, not pushed</H2>
      <P>
        Both the entry fee and the protocol fee accrue inside the vault and are transferred out by a
        separate, permissionless call. That is deliberate.
      </P>
      <P>
        Arc&apos;s USDC reverts for a blocklisted address, and Circle decides who is blocklisted. If
        the vault transferred a fee to its recipient inline, blocklisting that one address would
        make every deposit revert for everybody. Accruing keeps the deposit path free of any
        transfer a third party can make fail.
      </P>
      <Callout tone="good" title="This was a real bug, twice">
        The first version pushed protocol fees inside <Code>harvest()</Code>, which sits on the
        withdrawal path — blocklisting the treasury would have frozen every vault permanently. It
        was found by forking Arc. When the entry fee was added later it reintroduced the same shape
        on the deposit path, and the regression test written for the first bug caught the second.
      </Callout>

      <H2 id="changing">Who can change the rate</H2>
      <P>
        The vault owner, via <Code>setDepositFee</Code>, bounded by the 10% cap. The owner cannot
        withdraw your funds, mint shares, or pause withdrawals — there is no such function — but
        they can change what future deposits are charged.
      </P>
      <P>
        Check <Code>depositFeeBps()</Code> and the vault&apos;s owner before depositing. The{" "}
        <A href="/docs/contracts">contracts page</A> lists both.{" "}
        <A href="/docs/risks">Risks</A> covers the rest of what can go wrong.
      </P>
    </>
  );
}
