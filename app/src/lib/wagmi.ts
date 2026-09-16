import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

import { arc, arcTestnet } from "./chain";

/**
 * Which Arc network the dashboard targets by default.
 *
 * The factory is deployed per-network, so `NEXT_PUBLIC_FACTORY_ADDRESS` and this have to agree;
 * pointing the app at mainnet while the factory lives on testnet reads address zero and renders an
 * empty dashboard with no error. Listing the target first makes it wagmi's default chain.
 */
export const targetChain =
  process.env.NEXT_PUBLIC_CHAIN_ID === String(arcTestnet.id) ? arcTestnet : arc;

const chains = targetChain.id === arcTestnet.id ? ([arcTestnet, arc] as const) : ([arc, arcTestnet] as const);

export const config = createConfig({
  chains,
  connectors: [injected()],
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
