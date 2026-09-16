import { defineChain } from "viem";

/**
 * Arc mainnet.
 *
 * Gas is paid in USDC rather than ether. The native asset carries 18 decimals, while the canonical
 * ERC-20 interface at `USDC_ERC20` exposes the same balance with 6. Wallets and `formatEther`-style
 * helpers will read the native balance as 18-decimal, so never display a native amount with the
 * 6-decimal token formatter or it will be off by 1e12.
 */
export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.mainnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

/**
 * Which Arc network the app targets.
 *
 * Defaults to mainnet, where the factory now lives. The rule this follows is that the default must
 * always be a network that actually has a factory — pointing the app at one that does not renders
 * an empty dashboard rather than an error, which looks like a bug in the product. Set
 * NEXT_PUBLIC_CHAIN_ID to 5042002 to run against testnet.
 */
export const targetChain =
  process.env.NEXT_PUBLIC_CHAIN_ID === String(arcTestnet.id) ? arcTestnet : arc;
