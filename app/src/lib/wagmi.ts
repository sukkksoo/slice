import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

import { arc, arcTestnet, targetChain } from "./chain";

export { targetChain };

// Listing the target first makes it wagmi's default chain for reads.
const chains =
  targetChain.id === arcTestnet.id ? ([arcTestnet, arc] as const) : ([arc, arcTestnet] as const);

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
