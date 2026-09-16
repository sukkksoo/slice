import { NextResponse } from "next/server";

/**
 * Find the live Uniswap v4 pool for a token, so nobody has to read a log to list one.
 *
 * WHY THIS EXISTS
 *
 * A pool key is token + fee + tick spacing + hook, and launchpads deploy a *different* hook per
 * pool, so the hook cannot be guessed or hard-coded. Getting any field wrong produces a different
 * pool id and the honest but useless answer "no pool exists at this combination". Somebody trying
 * to list a perfectly good pool hit exactly that, because they left the hook at the zero address —
 * and there is no way for them to know otherwise without going and reading an event log.
 *
 * HOW IT SEARCHES
 *
 * Arc's RPC refuses an eth_getLogs range wider than about 5,000 blocks, and at half-second blocks
 * that is under an hour of history. Scanning days of chain that way would take hundreds of
 * requests, so it does not scan blindly: a pool cannot exist before its token does, and
 * eth_getCode against an old block tells you whether the token existed yet. Twenty or so of those
 * binary-search the deployment block, and the scan starts from there — which is also where the
 * pool almost always is, because a launchpad creates both in the same transaction.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const RPC: Record<string, string> = {
  "5042": "https://rpc.mainnet.arc.io",
  "5042002": "https://rpc.testnet.arc.io",
};

const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";

/** keccak256("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)") */
const INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

/** Measured against Arc's RPC: 5,000 succeeds, 10,000 is refused. */
const CHUNK = 5_000;
/** How far past the token's deployment to look. A launchpad pools in the same transaction. */
const CHUNKS_FORWARD = 8;

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

const hex = (n: number) => "0x" + n.toString(16);

/** The earliest block at which `address` has code, by bisection. */
async function deploymentBlock(url: string, address: string, head: number): Promise<number | null> {
  const codeAt = async (b: number) => ((await rpc<string>(url, "eth_getCode", [address, hex(b)])) ?? "0x").length > 2;

  if (!(await codeAt(head))) return null; // no code even now: not a contract
  if (await codeAt(0)) return 0;

  let lo = 0;
  let hi = head;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await codeAt(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

type Log = { topics: string[]; data: string; blockNumber: string };

function decode(log: Log) {
  const words = (log.data.slice(2).match(/.{64}/g) ?? []) as string[];
  // int24, two's complement — decoding it properly means a malformed pool reads as malformed
  // rather than as an enormous positive number.
  const raw = parseInt(words[1]!.slice(-6), 16);
  return {
    poolId: log.topics[1]!,
    currency0: "0x" + log.topics[2]!.slice(26),
    currency1: "0x" + log.topics[3]!.slice(26),
    fee: parseInt(words[0]!, 16),
    tickSpacing: raw >= 0x800000 ? raw - 0x1000000 : raw,
    hooks: "0x" + words[2]!.slice(24),
    block: parseInt(log.blockNumber, 16),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").toLowerCase();
  const chain = url.searchParams.get("chain") ?? "5042";
  const endpoint = RPC[chain];

  if (!endpoint) return NextResponse.json({ error: "unknown chain" }, { status: 400 });
  if (!/^0x[0-9a-f]{40}$/.test(token)) {
    return NextResponse.json({ error: "not an address" }, { status: 400 });
  }

  const padded = "0x" + "0".repeat(24) + token.slice(2);

  try {
    const head = parseInt(await rpc<string>(endpoint, "eth_blockNumber", []), 16);
    const born = await deploymentBlock(endpoint, token, head);
    if (born === null) {
      return NextResponse.json({ pools: [], reason: "no contract at that address" });
    }

    const found: ReturnType<typeof decode>[] = [];
    for (let i = 0; i < CHUNKS_FORWARD; i++) {
      const from = born + i * CHUNK;
      if (from > head) break;
      const to = Math.min(head, from + CHUNK);

      // The token may sit either side of the pair, though USDC's low address means it is almost
      // always currency1. Both positions are checked rather than assumed.
      for (const position of [3, 2]) {
        const topics: (string | null)[] = [INITIALIZE, null, null, null];
        topics[position] = padded;
        const logs = await rpc<Log[]>(endpoint, "eth_getLogs", [
          { address: POOL_MANAGER, fromBlock: hex(from), toBlock: hex(to), topics },
        ]);
        found.push(...logs.map(decode));
      }
      // A launchpad pools in the same transaction as the deployment, so the first chunk almost
      // always answers. Stopping there keeps the common case to a couple of hundred milliseconds.
      if (found.length > 0) break;
    }

    return NextResponse.json(
      { pools: found, deployedAt: born, head },
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "lookup failed" },
      { status: 502 },
    );
  }
}
