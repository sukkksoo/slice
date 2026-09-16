import { http, createConfig, fallback, type CreateConnectorFn } from "wagmi";
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

/**
 * What a wallet shows while asking someone to approve a connection: the site's name, its URL and
 * its icon. Wallets fetch the icon themselves, so it has to be a real absolute URL — an empty
 * `icons` array leaves a blank square, and a placeholder domain leaves a broken image, both of
 * which read as "something is wrong with this site" at precisely the wrong moment.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://delta-arc-sukiransandu-9022s-projects.vercel.app";
const ICON = `${SITE}/icon.png`;

const connectors: CreateConnectorFn[] = [
  injected(),
  coinbaseWallet({ appName: "Slice", appLogoUrl: ICON }),
];

if (projectId) {
  connectors.push(
    walletConnect({
      projectId,
      showQrModal: true,
      metadata: {
        name: "Slice",
        description: "Liquidity infrastructure for Arc — stake LP, earn streamed USDC fees.",
        url: SITE,
        icons: [ICON],
      },
    }),
  );
}

/**
 * Reads go through the site's own origin first, and straight to Arc only if that fails.
 *
 * A visitor's browser had every read return empty data while the same calls from the same
 * machine, outside the browser, succeeded. Extensions that intercept calls to RPC hosts they
 * recognise are the only thing left to differ, and one that does not know Arc can answer with
 * an empty result instead of an error. A request to this site's own /api/rpc is not something
 * those extensions are watching for. See src/app/api/rpc/route.ts for what the relay refuses.
 *
 * During server rendering there is no origin to be relative to, so the server dials Arc directly;
 * it is not running anyone's extensions.
 *
 * Writes are unaffected: the visitor's wallet signs and broadcasts through its own provider, and
 * never through these transports.
 */
function transportFor(chainId: number, direct: string) {
  if (typeof window === "undefined") return http(direct);
  const relay = `${window.location.origin}/api/rpc?chain=${chainId}`;
  return fallback([http(relay), http(direct)], { rank: false });
}

export const config = createConfig({
  chains,
  connectors,
  transports: {
    [arc.id]: transportFor(arc.id, arc.rpcUrls.default.http[0]!),
    [arcTestnet.id]: transportFor(arcTestnet.id, arcTestnet.rpcUrls.default.http[0]!),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
