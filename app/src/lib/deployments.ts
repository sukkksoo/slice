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
  // Replaced 2026-09-17. The factory at 0x219DF226… produced vaults that could not accept a
  // USDC-only deposit as their first one: the fee collection that follows the deposit's swap
  // poked a Uniswap position the vault had not opened yet, which v4 refuses outright. Those three
  // vaults are abandoned rather than migrated — the bug meant nobody ever got into them, so they
  // hold nothing.
  [arc.id]: {
    factory: "0x979889501A01aFc3264A87fC7e6cA54e659051D1",
    vaultDeployer: "0x36A50a05E39295290876aD7a97d01E418c55374D",
  },
};
