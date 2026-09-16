# Arc mainnet deployment runbook

Audience: whoever holds the deploying key. Every command here broadcasts real
transactions and spends real USDC. Read the preconditions before running any of them.

## Status

| | |
|---|---|
| Chain | Arc mainnet, id `5042` |
| Contracts | 102 tests green, incl. forks of live mainnet and testnet |
| Owner / treasury / feeRecipient | `0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030` |
| Entry fee | 0.5%, capped at 2% |
| Protocol fee | 10% of harvested yield, already at its ceiling — can be lowered, never raised |
| Third-party audit | **none** |

## Preconditions

**1. A deployer key that was not generated in a coding session.**

`contracts/.env` holds a throwaway key created for testnet. It is written in plaintext to
disk and must never hold mainnet funds. Deploy from a hardware wallet (`--ledger`) or a key
generated and stored outside this repo. The deployer only pays gas — it receives no ownership,
because `DELTA_OWNER` and `DELTA_TREASURY` are set to the address above.

**2. USDC on Arc mainnet, in the deploying account.**

Arc pays gas in USDC. Measured from dry runs:

| Step | Gas | Cost @ 45 gwei |
|---|---|---|
| Factory + deployer + oracle library | 10.1M | ~0.46 USDC |
| One vault | 4.2M | ~0.19 USDC |
| Seeding a position | varies | fund generously |

Hold at least **25 USDC** for the deploy plus whatever liquidity you intend to seed.

**3. The owner address needs its own gas.**

`0x76f7…5030` has never transacted on Arc and holds nothing. It cannot call `setParameters`,
`setDepositFee` or `setOwner` until it holds USDC. Fees flow to it regardless — collection is
permissionless, so anyone can push `collectDepositFees()` and `collectProtocolFees()`.

## Deploy

```bash
cd contracts
export ARC_RPC_URL=https://rpc.mainnet.arc.io
export DELTA_OWNER=0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030
export DELTA_TREASURY=0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030

# 1. Dry run. Must print "Script ran successfully" and chain id 5042.
forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL

# 2. Broadcast.
forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast --ledger
```

Record the printed `VaultFactory` and `VaultDeployer` addresses.

## Create a vault

`createVault` is permissionless and takes the pool key. For an Argus pool, USDC is currency0,
the fee tier is 10000 and tick spacing is 200:

```bash
cast send $FACTORY \
  "createVault((address,address,uint24,int24,address))" \
  "(0x3600000000000000000000000000000000000000,$TOKEN,10000,200,$HOOK)" \
  --rpc-url $ARC_RPC_URL --ledger
```

Read the hook address from the pool's `Initialize` event — Argus deploys one hook per pool, so
it is not a constant. The vault constructor rejects any hook carrying a remove-liquidity or
add/remove-delta flag, so a pool that could trap a withdrawal will not deploy.

## Verify before announcing

```bash
cast call $VAULT "owner()(address)"          --rpc-url $ARC_RPC_URL  # your address
cast call $VAULT "feeRecipient()(address)"   --rpc-url $ARC_RPC_URL  # your address
cast call $VAULT "depositFeeBps()(uint16)"   --rpc-url $ARC_RPC_URL  # 50
cast call $VAULT "protocolFeeBps()(uint16)"  --rpc-url $ARC_RPC_URL  # 1000
cast call $VAULT "symbol()(string)"          --rpc-url $ARC_RPC_URL  # sLP-<TOKEN>
```

Then deposit a small amount yourself and withdraw it before anyone else is invited in.

## Keep the oracle warm

Automated swaps need a 30-minute TWAP window. `poke()` is permissionless and cheap; run it on a
cron every few minutes, or `harvest()` will keep deferring the token side of collected fees.

## Then point the frontend at it

Update `app/src/lib/deployments.ts` with the mainnet factory address and chain id 5042, and
redeploy. Vercel Deployment Protection must be off for the site to be publicly reachable:
Settings → Deployment Protection → Vercel Authentication → Disabled.
