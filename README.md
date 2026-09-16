# Delta on Arc

Liquidity infrastructure for [Arc](https://www.arc.io/) (chain `5042`): LP staking with streamed
fee yield, and creator-configurable automatic liquidity injection. Built on Uniswap v4.

**For holders** — stake liquidity in any token, earn a share of that pool's swap fees, paid in USDC
and streamed over seven days.

**For token creators** — route any configurable share of trading fees, or a manually funded USDC
budget, into pool liquidity automatically on-chain, on a schedule or at market-cap milestones.

> **Unaudited.** Deployed contracts hold user funds. Do not put real money in this without an
> audit. See [Known limitations](#known-limitations).

---

## Why this is built the way it is

Arc is not a generic EVM chain, and three of its properties drove the design.

**Gas is USDC, in two representations.** The native asset is USDC with 18 decimals; the canonical
ERC-20 interface at `0x3600…0000` exposes *the same balance* with 6. Mixing them is a 10¹² error.
The vault sidesteps this entirely by rejecting native-currency pools — Arc's v4 pools quote against
the ERC-20 representation anyway, so supporting both would put a scale factor on every accounting
path for no benefit. `ArcChain.to6`/`from6` guard the boundary where conversion is unavoidable.

**There is no WETH.** Delta on Robinhood Chain streams fee rewards in WETH. On Arc the natural
denominator is USDC, which is also what every token pairs against.

**USDC is not an ordinary ERC-20.** It is a thin wrapper over two chain precompiles: a compliance
check at `0x1800…0001` (`isBlocklisted(address)`) and a native balance move at `0x1800…0000`. Every
transfer consults the blocklist and reverts for a blocked party — and Circle, not the protocol and
not the user, decides who that is. Any USDC *push* sitting on a shared code path is therefore a
freeze vector controlled by a third party. Protocol fees are pull-based because of this; see
[Freeze resistance](#freeze-resistance).

**Uniswap v4 positions are NFTs, and v4 has no built-in oracle.** So:

- *Shares, not NFTs.* Each vault owns one full-range position and issues ERC-20 shares against it.
  Escrowing individual position NFTs would make reward maths depend on each depositor's chosen
  range. Shares stay fungible and composable.
- *The protocol accumulates its own TWAP.* v4 moved oracles into hooks, and these vaults sit on
  pools they do not own. Every permissionless `poke()` records an observation; automated swaps
  require both a sufficiently long window and that spot has not diverged from the TWAP. An attacker
  has to hold a dislocated price across the whole window, not for one block.

**No hook required.** The fee router accepts USDC from anywhere — a launchpad forwarding fees, a
treasury wiring a budget, a plain transfer. Capturing fees via a custom v4 hook would have worked
only for pools deployed with that hook, which is nearly none of them.

---

## How it works

### Staking and the fee stream

```
swap fees accrue on the vault's position
        │
   harvest()  ── protocol fee ──► accrued ──► collectProtocolFees() ──► treasury
        │                                     (pulled, never pushed)
        ├── swap the token side into USDC (TWAP-bounded)
        │
        ├── streamBps  ──►  7-day linear stream to stakers  ──► claim()
        └── remainder  ──►  compound queue  ──► compound() ──► more liquidity, NAV up
```

**Fees are streamed, not booked instantly.** A harvest is a discrete jump in claimable value. If it
landed in NAV immediately, anyone could deposit in the block before a harvest and withdraw in the
block after, capturing fees they never provided liquidity for. Streaming linearly over seven days
makes that attack cost a full stream period of exposure — the same position honest LPs hold.

**Every liquidity change harvests first.** `modifyLiquidity` sweeps the position's *entire* accrued
fee balance regardless of the liquidity delta. A deposit that skipped the harvest would net those
fees against the depositor's own settlement and quietly hand them another staker's yield. This is
not hypothetical — it is the bug the test suite caught during development, worth 0.9 tokens per
round trip on a 1M-deep pool. See `test_lateDepositor_cannotSnipeAccruedFees`.

**Internal swaps collect twice.** When the vault swaps harvested fees through its own pool, that
swap pays LP fees back to its own position — *after* the collection point. Those have to be swept
before the next `modifyLiquidity`, or the next depositor nets them against their settlement. Same
bug, second-order.

### Freeze resistance

`harvest()` runs at the top of `deposit`, `depositUsdc`, `withdraw` and `compound`. Anything on that
path that a third party can make revert freezes the vault — **including withdrawals**.

The first version pushed the protocol fee to the treasury inside `harvest`. Because Arc's USDC
reverts for a blocklisted address, blocklisting the treasury would have bricked every user's funds
permanently. Fees now accrue to `pendingProtocolFees` and the treasury pulls them with
`collectProtocolFees()`, so a blocked treasury only fails its own collection.

The same reasoning is why `claim()` and withdrawal payouts push only to the caller's own chosen
address: a blocked staker is their own problem and cannot affect anyone else. `ProtocolFees.t.sol`
pins all of this.

### Creator fee routing

A `FeeRouter` holds USDC and deploys it into pool liquidity when a trigger fires:

| Mode | Trigger | Guard |
|---|---|---|
| **Cadence** | Fixed interval, ≥ 1 hour | — |
| **Milestone** | Fully diluted market cap crosses each threshold, in order, once each | Priced off the vault's **TWAP**, never spot |

`inject()` is permissionless — the trigger conditions decide validity, not the caller, so creators
do not have to run a keeper for it to work. Injection shares go to `injectionRecipient`; pointing
that at a burn address makes the added liquidity permanently unwithdrawable, which is the guarantee
most creators actually want to make.

---

## Layout

```
contracts/          Foundry
  src/
    LiquidityVault.sol    Shares over one full-range v4 position; streaming + compounding
    FeeRouter.sol         Creator automation: cadence / market-cap injection
    VaultFactory.sol      One vault per pool, registry, router deployment
    VaultDeployer.sol     Holds the vault creation bytecode (EIP-170; see below)
    libraries/
      ArcChain.sol        Arc addresses + the USDC 6/18-decimal invariant
      PoolOracle.sol      Self-recorded TWAP accumulator
      FullRange.sol       Tick-range and amount maths
      Settler.sol         v4 settle/take helpers
  test/                   79 tests; core suites run against both currency orderings
    LiquidityVault.t.sol  Staking, streaming, compounding, fee-sniping resistance
    FeeRouter.t.sol       Cadence and milestone injection
    ProtocolFees.t.sol    Blocklist freeze resistance
    ArcFork.t.sol         The protocol against the live Arc PoolManager
app/                Next.js 16 + wagmi + viem dashboard
```

**Why `VaultDeployer` exists:** a contract that calls `new LiquidityVault(...)` carries the vault's
entire ~21KB initcode in its own runtime code. The factory came to 31,721 bytes — over the
24,576-byte EIP-170 limit and undeployable. This surfaced only in the mainnet dry-run, not in tests,
because Foundry's test EVM does not enforce the limit by default. Splitting the creation code out
puts both halves under it.

---

## Running it

### Contracts

```bash
cd contracts
forge build
forge test                      # 75 offline tests
forge test --profile deep       # 100k fuzz runs
forge build --sizes             # confirm everything is under 24,576 bytes

# The 4 fork tests are skipped unless an RPC is provided
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.io forge test   # 79 tests
```

The fork suite runs against the **real** Arc PoolManager and the real USDC contract. It is what
caught the blocklist freeze vector described above, and it pins the two assumptions the protocol
makes about Arc's USDC: that the 6-decimal ERC-20 view mirrors the 18-decimal native balance, and
that transfers revert for a blocklisted party.

Arc's USDC cannot execute a transfer inside a Foundry fork at all — its balance-move precompile has
no implementation in revm — so the lifecycle tests etch a standard ERC-20 at the USDC address. The
PoolManager is the subject there; the real token is tested separately.

### Deploying

```bash
cp .env.example .env            # set DELTA_OWNER and DELTA_TREASURY
source .env

# Dry run against a mainnet fork — nothing is sent
forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL

# Live
forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast
```

The script refuses to run on any chain other than Arc mainnet or testnet, and checks that the
Uniswap PoolManager actually has bytecode at the expected address before deploying.

Deployment is three transactions and costs roughly **$3.20** at 338 gwei — Arc prices gas in USDC,
so Foundry's "ETH" label in the estimate is really USDC.

### Dashboard

```bash
cd app
cp .env.example .env.local      # set NEXT_PUBLIC_FACTORY_ADDRESS from the deploy output
npm install
npm run dev
```

---

## Verified against live Arc

Checked on mainnet at block 21,172,821:

| | Address | |
|---|---|---|
| PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | ✓ deployed |
| PositionManager | `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B` | ✓ deployed |
| StateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` | ✓ deployed |
| Quoter | `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94` | ✓ deployed |
| UniversalRouter | `0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1` | ✓ deployed |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✓ deployed |
| USDC (ERC-20) | `0x3600000000000000000000000000000000000000` | ✓ `symbol() = "USDC"`, `decimals() = 6` |

---

## Known limitations

- **Unaudited.** No third party has reviewed this.
- **Harvest swaps move the price.** Converting token-side fees to USDC is a real swap on the pool,
  and LPs bear its impact. It is bounded by `maxDeviationBps` (default 1% on sqrt price) and the
  amounts are small relative to pool depth, but it is not free.
- **Large single-sided deposits fill partially.** `depositUsdc` swaps half the input; if that would
  push the price past the deviation band, the swap stops early and the remainder is refunded. A
  deposit worth ~2.5% of pool depth deployed about 81% in testing; one worth ~0.2% deployed 99.9%.
- **Each harvest leaves a residue.** Converting fees is itself a swap that earns the position an LP
  fee in the token side, so `pendingAssetFees` never reaches exactly zero. It converges
  geometrically (~0.3% per pass) and is carried forward, not lost.
- **The oracle needs warming.** Automated swaps require a 30-minute TWAP window. Until it fills,
  harvest defers the token-side conversion rather than reverting — deposits and withdrawals keep
  working — but `depositUsdc` and `compound` revert.
- **`VaultDeployer` has 1,898 bytes of headroom.** Any material growth in `LiquidityVault` will
  push it over EIP-170. Check `forge build --sizes` before shipping changes.
- **A blocklisted vault is unrecoverable.** The pull-based fee design protects against a blocked
  *treasury* or *staker*, but if Circle blocklists a vault address itself, that vault's funds are
  frozen. Nothing on-chain can defend against this; it is inherent to building on Arc's USDC.
- **`PositionManager` and `UniversalRouter` differ on testnet.** The constants in `ArcChain` are
  mainnet addresses and have no code on 5042002. Nothing in the protocol calls them, but do not
  rely on them for tooling without checking the chain first.
- **No indexer.** The dashboard reads the factory registry and vault state directly over RPC. It
  does not show historical fee charts or 24h volume, which would need an indexer Arc does not yet
  have.
- **Governance is a single owner key** per vault, set at creation. Use a multisig.
