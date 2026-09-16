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

      <Callout tone="good" title="Slice earns from yield, not from your principal">
        The main charge is <Strong>10% of the fees a pool produces</Strong> — it only ever costs you
        when you are already earning. There is a small <Strong>0.5% entry fee</Strong> and no exit
        fee.
      </Callout>

      <H2 id="entry">Entry fee — 0.5% of a deposit</H2>
      <P>
        Charged on the tokens you supply, before any liquidity is added. Your shares are minted
        against the net amount, so the position you hold reflects what actually went in.
      </P>
      <P>
        This is a <Strong>haircut on principal</Strong>, which makes it the most expensive kind of
        fee to charge: it costs you whether or not the position ever earns, and it has to be won
        back before you are level. That is exactly why it is kept small — 0.5% is roughly two
        days of a busy pool&apos;s fees, not two months of them.
      </P>
      <UL>
        <LI>
          Capped in the contract at <Code>MAX_DEPOSIT_FEE_BPS</Code> = <Strong>2%</Strong>. The cap
          sits close to the rate on purpose: a 10% ceiling over a 0.5% fee would tell you nothing
          about what you might be charged tomorrow.
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
            "0.5%",
            "Your principal, on deposit",
            "feeRecipient",
          ],
          [
            <Strong key="b">Protocol fee</Strong>,
            "10%",
            "Yield only — each harvest of trading fees",
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

      <H2 id="pool-taxes">Launchpad taxes stack on top</H2>
      <P>
        Many Arc launchpads enforce a tax through a Uniswap v4 hook. That tax is not Slice&apos;s
        and Slice cannot waive it — but it does affect which deposit route is cheaper, so it is
        worth knowing before you stake.
      </P>
      <P>
        Measured against a live <Strong>Argus</Strong> pool (CINU), pinned to a single block so the
        price could not move mid-measurement:
      </P>
      <Table
        head={["Charge", "Rate", "Who gets it"]}
        rows={[
          [
            <Strong key="a">Pool fee</Strong>,
            "1.00%",
            "Liquidity providers — that is you, if you are staked",
          ],
          [<Strong key="b">Argus hook</Strong>, "3.00%", "The launchpad's splits: creator, buyback, holders"],
          [<Strong key="c">Total per swap</Strong>, "4.00%", "Matches the hook's own totalFeeBps()"],
        ]}
      />
      <P>
        The 1% pool fee is the thing you earn, and 1% per swap is high — good for a staker. The 3%
        hook tax only matters where Slice itself swaps.
      </P>
      <Callout tone="warn" title="On a taxed pool, deposit both sides">
        Withdrawals and two-sided deposits never swap, so they pay none of the hook tax. A USDC-only
        deposit swaps half the input, so on a 4%-per-swap pool it costs roughly{" "}
        <Strong>2% of the deposit</Strong> — four times the entry fee. Supplying both sides avoids
        it entirely, and on a taxed pool that is by far the bigger saving.
      </Callout>
      <P>
        Harvesting is also a swap: converting the token side of collected fees to USDC pays the same
        4%. Since roughly half of what a pool collects is on the token side, the drag is about 2% of
        harvested fees — small against what the 1% pool fee brings in, but not nothing.
      </P>
      <P>
        <Code>contracts/script/measure-hook-tax.sh</Code> measures this for any pool. It has to run
        against a live node rather than a fork, because these hooks move USDC and Arc&apos;s
        balance-move precompile does not exist in Foundry&apos;s EVM.
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

      <H2 id="protocol">Protocol fee — 10% of harvested yield</H2>
      <P>
        Taken from trading fees as they are collected, before the rest is streamed to stakers. It
        costs you nothing on a quiet pool, and scales with what the pool actually produces — which
        is the right way round for a fee.
      </P>
      <P>
        It is set to its own ceiling, so the owner can <Strong>lower</Strong> it but can never raise
        it. The rate you read when you deposit is the worst it will ever be. 10% is in line with
        comparable vaults elsewhere.
      </P>

      <H2 id="changing">Who can change the rates</H2>
      <P>
        The vault owner, via <Code>setDepositFee</Code> and <Code>setParameters</Code>, within the
        caps above. The owner cannot withdraw your funds, mint shares, or pause withdrawals — there
        is no such function.
      </P>
      <P>
        Check <Code>depositFeeBps()</Code> and the vault&apos;s owner before depositing. The{" "}
        <A href="/docs/contracts">contracts page</A> lists both.{" "}
        <A href="/docs/risks">Risks</A> covers the rest of what can go wrong.
      </P>
    </>
  );
}
