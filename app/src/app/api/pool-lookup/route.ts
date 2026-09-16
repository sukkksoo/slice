import { NextResponse } from "next/server";

/**
 * Find the live Uniswap v4 pools for a token, ranked by which one is actually worth staking in.
 *
 * WHY THIS EXISTS
 *
 * A pool key is token + fee + tick spacing + hook, and launchpads deploy a different hook per
 * pool, so the hook cannot be guessed. Any wrong field yields a different pool id and the honest
 * but useless "no pool exists at this combination" — which is what somebody saw while trying to
 * list a perfectly good pool, having left the hook at the zero address, the only guess available
 * to them without reading an event log.
 *
 * WHY IT RANKS RATHER THAN RETURNING THE NEWEST
 *
 * One token frequently has several pools. A real example: five, of which the first was the
 * launchpad's 1% pool holding all the liquidity and the rest were empty vanity pools at fees like
 * 33% and 93%, one of them quoted in the native asset rather than USDC. Picking the most recent
 * returned a worthless pool and made a live token look unlistable. Liquidity is the thing that
 * decides, so each candidate is priced and the list comes back ordered by it, with the ones the
 * vault would refuse marked rather than hidden.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const RPC: Record<string, string> = {
  "5042": "https://rpc.mainnet.arc.io",
  "5042002": "https://rpc.testnet.arc.io",
};

const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b";
const USDC = "0x3600000000000000000000000000000000000000";

/** keccak256("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)") */
const INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

/** getLiquidity(bytes32) on StateView. Verified with `cast sig` — 0x9dc29fac, used here first,
 *  is burn(address,uint256), so every pool priced as empty and the ranking did nothing. */
const GET_LIQUIDITY = "0xfa6793d5";

/**
 * Hook permissions that could stand between a staker and their exit. Mirrors
 * EXIT_UNSAFE_HOOK_FLAGS in LiquidityVault.sol — a pool whose hook carries any of these is refused
 * by the vault constructor, so it is worth saying so before somebody spends gas finding out.
 */
const EXIT_UNSAFE = (1n << 9n) | (1n << 8n) | (1n << 1n) | (1n << 0n);

/** Measured against Arc's RPC: 5,000 succeeds, 10,000 is refused. */
const CHUNK = 5_000;
const CHUNKS_FORWARD = 8;

/**
 * Arc's public RPC rate-limits, and a naive lookup spends about forty-five sequential calls —
 * enough to be refused outright. Three things keep it under the limit: JSON-RPC batching, so a set
 * of independent calls costs one HTTP request; a short backoff when the limit is hit anyway; and
 * a process-level cache, because the same token gets looked up repeatedly while somebody edits the
 * field.
 */
async function rpcBatch(url: string, calls: { method: string; params: unknown[] }[]): Promise<unknown[]> {
  if (calls.length === 0) return [];

  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json()) as
      | { id: number; result?: unknown; error?: { message: string } }[]
      | { error?: { message: string } };

    if (!Array.isArray(json)) {
      const message = json.error?.message ?? "malformed response";
      // A rate limit is transient; anything else will not improve by asking again.
      if (/rate limit|too many/i.test(message) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      throw new Error(message);
    }

    const limited = json.find((r) => r.error && /rate limit|too many/i.test(r.error.message));
    if (limited && attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      continue;
    }

    const out = new Array<unknown>(calls.length);
    for (const r of json) out[r.id] = r.error ? undefined : r.result;
    return out;
  }
  throw new Error("rate limit exceeded");
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const [one] = await rpcBatch(url, [{ method, params }]);
  return one as T;
}

/** Token -> response, for the lifetime of the server process. */
const cache = new Map<string, { at: number; body: unknown }>();
const CACHE_MS = 120_000;

const hex = (n: number) => "0x" + n.toString(16);

/** The earliest block at which `address` has code, by bisection. */
async function deploymentBlock(url: string, address: string, head: number): Promise<number | null> {
  // Probe a spread of blocks in one batched request first. Tokens people look up are almost always
  // recent, so this usually brackets the deployment immediately and turns ~25 sequential round
  // trips into one plus a handful.
  const probes = [0, 0.5, 0.75, 0.875, 0.94, 0.97, 0.985, 0.995, 1].map((f) => Math.floor(head * f));
  const codes = (await rpcBatch(
    url,
    probes.map((b) => ({ method: "eth_getCode", params: [address, hex(b)] })),
  )) as (string | undefined)[];

  const present = codes.map((c) => (c ?? "0x").length > 2);
  if (!present[present.length - 1]) return null; // no code even at head: not a contract
  if (present[0]) return 0;

  let lo = probes[0]!;
  let hi = probes[probes.length - 1]!;
  for (let i = 1; i < probes.length; i++) {
    if (present[i]) {
      hi = probes[i]!;
      lo = probes[i - 1]!;
      break;
    }
  }

  const codeAt = async (b: number) =>
    ((await rpc<string>(url, "eth_getCode", [address, hex(b)])) ?? "0x").length > 2;
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
  // int24 two's complement, so a malformed pool reads as malformed rather than as a huge positive.
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

  const cacheKey = `${chain}:${token}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json(hit.body, { headers: { "cache-control": "public, max-age=120" } });
  }

  try {
    const head = parseInt(await rpc<string>(endpoint, "eth_blockNumber", []), 16);
    const born = await deploymentBlock(endpoint, token, head);
    if (born === null) return NextResponse.json({ pools: [], reason: "no contract at that address" });

    const raw: ReturnType<typeof decode>[] = [];
    for (let i = 0; i < CHUNKS_FORWARD; i++) {
      const from = born + i * CHUNK;
      if (from > head) break;
      const to = Math.min(head, from + CHUNK);

      // Both currency positions in one request: the token is almost always currency1, because
      // USDC's address is low, but checking costs nothing when batched.
      const results = (await rpcBatch(
        endpoint,
        [3, 2].map((position) => {
          const topics: (string | null)[] = [INITIALIZE, null, null, null];
          topics[position] = padded;
          return {
            method: "eth_getLogs",
            params: [{ address: POOL_MANAGER, fromBlock: hex(from), toBlock: hex(to), topics }],
          };
        }),
      )) as (Log[] | undefined)[];

      for (const logs of results) raw.push(...(logs ?? []).map(decode));

      // A launchpad creates the token and its pool in the same transaction, and a token's other
      // pools follow within minutes. One chunk past the first hit is generous; scanning the full
      // eight every time was spending forty requests to find nothing.
      if (raw.length > 0 && i >= 1) break;
    }

    // Price every candidate. A pool with no liquidity earns nothing however real it looks, and on
    // a token with several pools that is the only thing separating the launchpad's from the junk.
    const liquidities = (await rpcBatch(
      endpoint,
      raw.map((p) => ({
        method: "eth_call",
        params: [{ to: STATE_VIEW, data: GET_LIQUIDITY + p.poolId.slice(2) }, "latest"],
      })),
    )) as (string | undefined)[];

    const priced = raw.map((p, i) => {
      // An unreadable pool is simply worth nothing for ranking purposes.
      let liquidity = "0";
      try {
        liquidity = BigInt(liquidities[i] || "0x0").toString();
      } catch {
        /* keep zero */
      }
      const usdcQuoted =
        p.currency0.toLowerCase() === USDC.toLowerCase() ||
        p.currency1.toLowerCase() === USDC.toLowerCase();
      const exitSafe = (BigInt(p.hooks) & EXIT_UNSAFE) === 0n;
      return { ...p, liquidity, usdcQuoted, exitSafe, usable: usdcQuoted && exitSafe };
    });

    // Usable first, then by liquidity. Unusable pools are kept so the UI can explain why a pool
    // somebody expected to see is not offered, rather than silently omitting it.
    priced.sort((a, b) => {
      if (a.usable !== b.usable) return a.usable ? -1 : 1;
      const d = BigInt(b.liquidity) - BigInt(a.liquidity);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
    });

    const body = { pools: priced, deployedAt: born, head };
    cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "cache-control": "public, max-age=120" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "lookup failed" },
      { status: 502 },
    );
  }
}
