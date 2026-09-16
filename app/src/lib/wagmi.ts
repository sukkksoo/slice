import { http, createConfig, type CreateConnectorFn } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

import { arc, arcTestnet, targetChain } from "./chain";

export { targetChain };

// Listing the target first makes it wagmi's default chain for reads.
const chains =
  targetChain.id === arcTestnet.id ? ([arcTestnet, arc] as const) : ([arc, arcTestnet] as const);

/**
 * WalletConnect is what lets a phone connect at all.
 *
 * `injected` only finds a wallet that has injected itself into this page, which on mobile means
 * the person is already inside a wallet's own browser. Everyone arriving from a normal phone
 * browser has no connector without this. It needs a free project id from
 * https://cloud.reown.com — set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to switch it on.
 *
 * Absent the id the connector is simply left out. Constructing it with an empty or invalid id
 * does not fail quietly: it throws inside the relay client at connect time, which would break the
 * button for desktop users too.
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors: CreateConnectorFn[] = [
  injected(),
  coinbaseWallet({ appName: "Slice", appLogoUrl: "https://slice.link/icon.png" }),
];

if (projectId) {
  connectors.push(
    walletConnect({
      projectId,
      showQrModal: true,
      metadata: {
        name: "Slice",
        description: "Liquidity infrastructure for Arc — stake LP, earn streamed USDC fees.",
        url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://slice.link",
        icons: [],
      },
    }),
  );
}

export const config = createConfig({
  chains,
  connectors,
  transports: {
    [arc.id]: http(),
    [arcTestnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
