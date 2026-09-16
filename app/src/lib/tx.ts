import type { Hex } from "viem";

import { targetChain } from "./chain";

export function explorerTx(hash: Hex): string {
  return `${targetChain.blockExplorers?.default.url ?? ""}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${targetChain.blockExplorers?.default.url ?? ""}/address/${address}`;
}

/**
 * What each custom error means to the person who just saw their transaction fail.
 *
 * viem decodes a revert into its error name when the ABI carries it, but the name alone —
 * `SlippageExceeded()` — tells a person nothing about what to do next. Every entry here says
 * what happened and what would make it succeed, in that order.
 */
const EXPLANATIONS: Record<string, string> = {
  SlippageExceeded:
    "You would have received less than your slippage setting allows, so the deposit refused itself rather than fill at a worse price. Nothing was taken. Raise the tolerance if the pool is volatile, or try again.",
  // Uniswap's, not ours: a zero-delta update against a position holding nothing. Kept because a
  // vault deployed before this was fixed still reverts this way on its first USDC-only deposit,
  // and "CannotUpdateEmptyPosition" tells nobody anything.
  CannotUpdateEmptyPosition:
    "This vault is running an older build that cannot accept a USDC-only deposit as its very first one. Supply both tokens instead, or use a vault listed more recently.",
  PriceOutOfBand:
    "The pool's spot price has drifted too far from its 30-minute average for the vault to swap safely, or the oracle is not warm yet. Two-sided deposits do not swap and are unaffected.",
  ZeroAmount:
    "Nothing would be deployed at that size — the amount is too small for the pool's current ratio. Try a larger amount, or supply both sides.",
  InsufficientShares: "You are trying to withdraw more shares than you hold.",
  NothingToCompound: "There is no USDC queued to compound right now.",
  HookMayBlockExit:
    "This pool's hook can run on withdrawals, so the vault refuses it — it could trap or skim a staker's exit.",
  PairMustQuoteUsdc: "The pool must pair USDC with one other token.",
  NativeCurrencyUnsupported: "Pools holding the native gas asset are not supported.",
  PoolNotInitialized:
    "No pool exists at that exact combination of token, fee tier, tick spacing and hook.",
  VaultExists: "This pool already has a vault.",
  NotOwner: "Only the vault owner can do that.",
  NotCreator: "Only the router's creator can do that.",
  NotDue: "The router's trigger has not been met yet — the interval has not elapsed, or the market cap is below the next milestone.",
  OracleNotReady: "The vault's price oracle is still warming up. Milestone triggers need it.",
  BelowMinimum: "The injection would be below the router's configured minimum.",
  IntervalTooShort: "The cadence interval must be at least one hour.",
  InvalidBps: "The percentage must be between 0 and 100.",
  MilestonesNotAscending: "Milestones must be listed in strictly ascending order.",
  NoMilestones: "Enter at least one milestone.",
  ZeroAddress: "An address is missing.",
  ERC20InsufficientBalance: "Your balance is lower than the amount entered.",
  ERC20InsufficientAllowance: "The vault is not approved to move that much. Approve first.",
  SafeERC20FailedOperation:
    "A token transfer failed. On Arc this usually means USDC refused the transfer for a blocklisted address.",
};

/** One sentence a person can act on, from whatever the wallet or RPC threw. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return "You cancelled the request in your wallet.";
  }
  if (/insufficient funds/i.test(message)) {
    return "Not enough USDC for gas. Arc pays gas in USDC.";
  }
  if (/chain mismatch|does not match the target chain|wrong network/i.test(message)) {
    return `Your wallet is on another network. Switch to ${targetChain.name}.`;
  }

  // viem formats a decoded revert as `Error: SlippageExceeded()` or `reason: SlippageExceeded`.
  const named = message.match(/\b([A-Z][A-Za-z0-9]+)\(\)/) ?? message.match(/reason:\s*([A-Z]\w+)/);
  const name = named?.[1];
  if (name && EXPLANATIONS[name]) return EXPLANATIONS[name];

  const first = message.split("\n")[0]?.trim();
  return first && first.length < 200 ? first : "The transaction failed.";
}
