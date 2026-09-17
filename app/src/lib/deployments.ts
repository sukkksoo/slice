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
  // Third factory, 2026-09-17. Two earlier ones are abandoned rather than migrated; neither ever
  // held a share, so there was nothing to move.
  //
  //   0x219DF226…  Its vaults could not accept a USDC-only deposit as their first one. The fee
  //                collection that follows the deposit's swap poked a Uniswap position the vault
  //                had not opened yet, which v4 refuses outright. Every vault starts in that
  //                state, so every vault turned away whoever tried to use it first.
  //
  //   0x97988950…  Its vaults cooled their own oracles. PoolOracle retained an observation on
  //                every poke, into a ring of 32, and deposits, withdrawals and harvests all poke
  //                — so a vault with traffic overwrote its own history inside the 30-minute TWAP
  //                window and quietly stopped pricing swaps. Replaced while TVL was still zero,
  //                because the failure arrives with success and the fix is a redeploy.
  [arc.id]: {
    factory: "0x9ABDd9Ba9C8Cb77e8676141c5bDa18fD107beD7D",
    vaultDeployer: "0x32F0b8964B51E157Fb58AdF33fdA228Cf16476AF",
  },
};
