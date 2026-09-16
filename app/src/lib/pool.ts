import { encodeAbiParameters, isAddress, keccak256, type Address, type Hex } from "viem";

import { ARC } from "./contracts";

/** A Uniswap v4 pool key, in the order the PoolManager encodes it. */
export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

/**
 * Hook permissions that could stand between a staker and their exit.
 *
 * A v4 hook encodes its permissions in the low 14 bits of its own address. The vault refuses any
 * pool whose hook can run on removal or return a delta on add/remove, because such a hook could
 * revert a withdrawal or skim it. Mirrors `EXIT_UNSAFE_HOOK_FLAGS` in LiquidityVault.sol — keep
 * the two in step.
 */
const BEFORE_REMOVE_LIQUIDITY = 1n << 9n;
const AFTER_REMOVE_LIQUIDITY = 1n << 8n;
const AFTER_ADD_LIQUIDITY_RETURNS_DELTA = 1n << 1n;
const AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA = 1n << 0n;

export const EXIT_UNSAFE_HOOK_FLAGS =
  BEFORE_REMOVE_LIQUIDITY |
  AFTER_REMOVE_LIQUIDITY |
  AFTER_ADD_LIQUIDITY_RETURNS_DELTA |
  AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA;

/** Which of the unsafe permissions a hook actually carries, for explaining a rejection. */
export function unsafeHookPermissions(hooks: Address): string[] {
  const bits = BigInt(hooks) & 0x3fffn;
  const named: [bigint, string][] = [
    [BEFORE_REMOVE_LIQUIDITY, "runs before liquidity is removed"],
    [AFTER_REMOVE_LIQUIDITY, "runs after liquidity is removed"],
    [AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA, "can skim a withdrawal"],
    [AFTER_ADD_LIQUIDITY_RETURNS_DELTA, "can skim a deposit"],
  ];
  return named.filter(([bit]) => (bits & bit) !== 0n).map(([, label]) => label);
}

/** Sort two currencies the way v4 requires: strictly ascending by address. */
export function sortCurrencies(a: Address, b: Address): [Address, Address] {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

/**
 * The pool's id: keccak256 of the ABI-encoded key.
 *
 * @dev This must match `PoolIdLibrary.toId` exactly. A mismatch would not error — it would look
 *      up an unrelated, almost certainly uninitialised pool and report a live pool as missing.
 */
export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [key],
    ),
  );
}

/** Build the key for a USDC-quoted pool against `token`, with the currencies correctly ordered. */
export function usdcPoolKey(
  token: Address,
  fee: number,
  tickSpacing: number,
  hooks: Address,
): PoolKey {
  const [currency0, currency1] = sortCurrencies(ARC.USDC, token);
  return { currency0, currency1, fee, tickSpacing, hooks };
}

export type PoolProblem = { code: string; detail: string };

/**
 * Every reason the vault constructor would reject this pool, checked before a transaction is sent.
 *
 * Each case mirrors a specific revert in LiquidityVault's constructor or VaultFactory.createVault.
 * Checking here is not a substitute for the on-chain check — it exists so a rejection costs the
 * user an explanation rather than a failed transaction and its gas.
 */
export function validatePool(token: string, hooks: string): PoolProblem[] {
  const problems: PoolProblem[] = [];

  if (!isAddress(token)) {
    problems.push({ code: "Token address", detail: "That is not a valid address." });
  } else if (token.toLowerCase() === ARC.USDC.toLowerCase()) {
    problems.push({
      code: "PairMustQuoteUsdc",
      detail: "The pool must pair USDC with something else. Both sides cannot be USDC.",
    });
  }

  if (!isAddress(hooks)) {
    problems.push({ code: "Hook address", detail: "That is not a valid address." });
  } else {
    const unsafe = unsafeHookPermissions(hooks as Address);
    if (unsafe.length > 0) {
      problems.push({
        code: "HookMayBlockExit",
        detail: `This pool's hook ${unsafe.join(", ")}. The vault refuses such a pool — on a vault other people deposit into, that is a trap rather than a fee.`,
      });
    }
  }

  return problems;
}

/** Fee tiers Uniswap v4 uses conventionally, with the tick spacing each is normally paired with. */
export const FEE_TIERS = [
  { fee: 100, tickSpacing: 1, label: "0.01%" },
  { fee: 500, tickSpacing: 10, label: "0.05%" },
  { fee: 3000, tickSpacing: 60, label: "0.30%" },
  { fee: 10000, tickSpacing: 200, label: "1.00%  ·  most launchpads" },
] as const;

export const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint24" }, { type: "uint24" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getLiquidity",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint128" }],
    stateMutability: "view",
  },
] as const;
