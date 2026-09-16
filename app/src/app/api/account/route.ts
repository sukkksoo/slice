import { NextResponse } from "next/server";

import { DEPLOYMENTS } from "@/lib/deployments";
import { deploymentBlock, hexBlock, rpcAll, rpcOne } from "@/lib/rpc-server";

/**
 * What an address has created: the pools it listed and the fee routers it deployed.
 *
 * Neither is held in contract storage against the creator — the factory records which vault serves
 * a pool, not who asked for it — so the only record is the `creator` field on VaultCreated and
 * RouterCreated. Reading events is the sole way to answer "show me the pools I listed".
 *
 * Staked positions are deliberately NOT here. Those live in contract storage as share balances and
 * the app reads them directly; a second source of truth for somebody's money would be a liability
 * rather than a convenience.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const RPC: Record<string, string> = {
  "5042": "https://rpc.mainnet.arc.io",
  "5042002": "https://rpc.testnet.arc.io",
};

const CHUNK = 5_000;

type Log = { topics: string[]; data: string; blockNumber: string; transactionHash: string };

const cache = new Map<string, { at: number; body: unknown }>();
const CACHE_MS = 30_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = (url.searchParams.get("address") ?? "").toLowerCase();
  const chain = url.searchParams.get("chain") ?? "5042";
  const endpoint = RPC[chain];
  const factory = DEPLOYMENTS[Number(chain)]?.factory;

  if (!endpoint || !factory) return NextResponse.json({ error: "unknown chain" }, { status: 400 });
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: "not an address" }, { status: 400 });
  }

  const key = `${chain}:${address}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  const padded = "0x" + "0".repeat(24) + address.slice(2);

  try {
    const head = parseInt(await rpcOne<string>(endpoint, "eth_blockNumber", []), 16);

    // The factory cannot have emitted anything before it existed, which bounds the scan to the
    // life of this deployment rather than the life of the chain.
    const from0 = (await deploymentBlock(endpoint, factory, head)) ?? head;

    const calls = [];
    for (let from = from0; from <= head; from += CHUNK) {
      const to = Math.min(head, from + CHUNK);
      // `creator` is the third indexed parameter on both events, so the node filters for us.
      calls.push({
        method: "eth_getLogs",
        params: [
          {
            address: factory,
            fromBlock: hexBlock(from),
            toBlock: hexBlock(to),
            topics: [null, null, null, padded],
          },
        ],
      });
    }

    const results = (await rpcAll(endpoint, calls, { heavy: true })) as (Log[] | null | undefined)[];

    // Refuse to answer on a partial scan. A refused range coerced to an empty array is
    // indistinguishable from "no events here", and the result would be a page telling somebody
    // they have never listed a pool when one range of the scan simply failed. Saying nothing is
    // better than saying something confident and wrong about what belongs to them.
    if (results.some((r) => r === undefined)) {
      return NextResponse.json(
        { error: "the chain scan came back incomplete; try again in a moment" },
        { status: 503 },
      );
    }

    const logs = results.flatMap((l) => l ?? []);

    // Distinguished by shape rather than a hard-coded topic hash: VaultCreated carries a string in
    // data and RouterCreated carries nothing, and a mistyped hash would silently match neither.
    const vaults: { vault: string; poolId: string; block: number; tx: string }[] = [];
    const routers: { router: string; vault: string; block: number; tx: string }[] = [];

    for (const log of logs) {
      const t = log.topics;
      if (t.length !== 4) continue;
      const block = parseInt(log.blockNumber, 16);
      if (log.data && log.data.length > 2) {
        vaults.push({ poolId: t[1]!, vault: "0x" + t[2]!.slice(26), block, tx: log.transactionHash });
      } else {
        routers.push({
          vault: "0x" + t[1]!.slice(26),
          router: "0x" + t[2]!.slice(26),
          block,
          tx: log.transactionHash,
        });
      }
    }

    vaults.sort((a, b) => b.block - a.block);
    routers.sort((a, b) => b.block - a.block);

    const body = { vaults, routers, scannedFrom: from0, head };
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "lookup failed" },
      { status: 502 },
    );
  }
}
