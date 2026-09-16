import type { Abi, Address } from "viem";

import { targetChain } from "./chain";
import { DEPLOYMENTS } from "./deployments";

import LiquidityVaultAbi from "@/abis/LiquidityVault.json";
import VaultFactoryAbi from "@/abis/VaultFactory.json";
import FeeRouterAbi from "@/abis/FeeRouter.json";

// Imported from JSON, so these arrive untyped. The `as Abi` cast is what lets viem and wagmi
// accept them in contract calls; without it every `useReadContracts` entry fails to narrow.
export const vaultAbi = LiquidityVaultAbi as Abi;
export const factoryAbi = VaultFactoryAbi as Abi;
export const routerAbi = FeeRouterAbi as Abi;

/**
 * Canonical Arc addresses. See contracts/src/libraries/ArcChain.sol — keep the two in step.
 *
 * `USDC`, `POOL_MANAGER`, `STATE_VIEW` and `QUOTER` carry identical bytecode on Arc mainnet (5042)
 * and testnet (5042002), so one set of constants serves both. `POSITION_MANAGER` and
 * `UNIVERSAL_ROUTER` are MAINNET ONLY — they have no code at these addresses on testnet. Nothing
 * in this app calls them today; if that changes they must become per-chain lookups.
 */
export const ARC = {
  /** 6-decimal ERC-20 interface to Arc's native USDC. Same on both networks. */
  USDC: "0x3600000000000000000000000000000000000000" as Address,
  /** Same on both networks. */
  POOL_MANAGER: "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address,
  /** Same on both networks. */
  STATE_VIEW: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b" as Address,
  /** Mainnet only — absent on testnet. */
  POSITION_MANAGER: "0x6049c9a0e26405C0985f9E3685C87d0aE917f82B" as Address,
  /** Mainnet only — absent on testnet. */
  UNIVERSAL_ROUTER: "0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1" as Address,
} as const;

export const USDC_DECIMALS = 6;

/**
 * The factory for the targeted chain.
 *
 * Resolution order: an explicit environment override, then the known deployment for this chain,
 * then empty — in which case the dashboard renders its "not deployed yet" state rather than
 * silently reading address zero.
 */
export const FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
  DEPLOYMENTS[targetChain.id]?.factory ||
  "") as Address | "";

export const erc20Abi = [
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * Pin a batch of contract reads to the chain the app is about.
 *
 * wagmi's read hooks default to the *connected* chain, so a visitor whose wallet sits on another
 * network has every Arc address queried over there. The calls do not fail loudly — they return
 * empty data, which surfaces as "Cannot decode zero data" and an empty pool list on a protocol
 * that demonstrably has a live vault. What the app reads is a property of the protocol, not of
 * whatever network the visitor last used, so it is always stated.
 *
 * `useReadContract` (singular) takes `chainId` at the top level; the plural form wants it on each
 * entry, which is what this is for. The cast preserves the tuple type so result inference at the
 * call site is unchanged.
 */
export function onArc<T extends readonly unknown[]>(contracts: T): T {
  return contracts.map((c) => ({ ...(c as object), chainId: targetChain.id })) as unknown as T;
}
