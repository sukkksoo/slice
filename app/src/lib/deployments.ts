import type { Address } from "viem";

import { arc, arcTestnet } from "./chain";

/**
 * Known Slice deployments, by chain id.
 *
 * Kept in source rather than only in environment variables so the app is correct by default
 * wherever it is hosted. `NEXT_PUBLIC_FACTORY_ADDRESS` still overrides, which is what you want
 * when pointing a preview build at your own factory.
 */
export const DEPLOYMENTS: Record<number, { factory: Address; vaultDeployer: Address } | undefined> = {
  [arcTestnet.id]: {
    factory: "0x28e745eBf4b8E8b758c7B4a11b2e453322cDC3CA",
    vaultDeployer: "0x1F522743D95DD04b934508279a69683Ad9a37eF9",
  },
  // Arc mainnet: not deployed. The contracts are unaudited; testnet is the ceiling for now.
  [arc.id]: undefined,
};
