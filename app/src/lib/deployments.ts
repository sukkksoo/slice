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
  [arc.id]: {
    factory: "0x219DF226816e4CCcAAF8C7fAB7469837e857c05b",
    vaultDeployer: "0x1782B001f635BE1f19BB4B5ef1B9E8F1d2e64759",
  },
};
