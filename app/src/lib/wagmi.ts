import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

import { arc, arcTestnet } from "./chain";

export const config = createConfig({
  chains: [arc, arcTestnet],
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
