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
    factory: "0xc013A0a50A0841d1341EA85461431411DC4cb514",
    vaultDeployer: "0xFDfd46103A5D507827E59aa68247537657284c47",
  },
  // Arc mainnet: not deployed. The contracts are unaudited; testnet is the ceiling for now.
  [arc.id]: undefined,
};
