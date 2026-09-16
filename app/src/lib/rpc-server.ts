/**
 * Server-side JSON-RPC against Arc, shaped around what its public endpoint actually tolerates.
 *
 * Measured rather than assumed, because the limits are not documented and getting them wrong is
 * silent: a refused sub-request comes back as an error object inside an otherwise successful
 * batch, and code that treats it as "no results" reports a confident wrong answer.
 *
 *   - eth_getLogs is refused beyond about 5,000 blocks in one range.
 *   - A batch may contain many cheap calls, but only about three eth_getLogs succeed per request;
 *     the rest come back with -32005 rate limit exceeded. Sending eight got five refusals.
 *
 * So heavy calls go in small paced groups, and anything still failing is retried with backoff
 * before the caller is told the scan is incomplete.
 */

export type Call = { method: string; params: unknown[] };

/** The most log queries that reliably succeed in one request. */
const HEAVY_PER_BATCH = 3;
/** Breathing room between groups; the limiter is per unit time, not per connection. */
const PACE_MS = 260;

const isRateLimit = (m: string) => /rate limit|too many|-32005/i.test(m);

async function once(url: string, calls: Call[]): Promise<(unknown | undefined)[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i, ...c }))),
    cache: "no-store",
  });

  const json = (await res.json()) as
    | { id: number; result?: unknown; error?: { message: string } }[]
    | { error?: { message: string } };

  // A whole-body error means nothing in the batch ran.
  if (!Array.isArray(json)) {
    const message = json.error?.message ?? "malformed response";
    if (isRateLimit(message)) return calls.map(() => undefined);
    throw new Error(message);
  }

  const out = new Array<unknown | undefined>(calls.length);
  for (const r of json) {
    if (!r.error) out[r.id] = r.result;
    else if (isRateLimit(r.error.message)) out[r.id] = undefined;
    // A genuine per-call error — a bad range, say — is a real answer of "nothing", not a retry.
    else out[r.id] = null;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `calls`, retrying only the ones the limiter refused.
 *
 * `undefined` in the result means the call never completed; `null` means the node answered with an
 * error of its own. Callers should treat the first as "ask again" and the second as a real answer.
 */
export async function rpcAll(
  url: string,
  calls: Call[],
  { heavy = false, attempts = 4 }: { heavy?: boolean; attempts?: number } = {},
): Promise<(unknown | undefined)[]> {
  if (calls.length === 0) return [];

  const results = new Array<unknown | undefined>(calls.length).fill(undefined);
  let pending = calls.map((_, i) => i);
  const size = heavy ? HEAVY_PER_BATCH : calls.length;

  for (let attempt = 0; attempt < attempts && pending.length > 0; attempt++) {
    if (attempt > 0) await sleep(PACE_MS * 2 ** attempt);

    const stillPending: number[] = [];
    for (let g = 0; g < pending.length; g += size) {
      const group = pending.slice(g, g + size);
      const out = await once(
        url,
        group.map((i) => calls[i]!),
      );
      group.forEach((i, n) => {
        if (out[n] === undefined) stillPending.push(i);
        else results[i] = out[n];
      });
      if (g + size < pending.length) await sleep(PACE_MS);
    }
    pending = stillPending;
  }

  return results;
}

export async function rpcOne<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const [v] = await rpcAll(url, [{ method, params }]);
  if (v === undefined) throw new Error("rate limit exceeded");
  return v as T;
}

export const hexBlock = (n: number) => "0x" + n.toString(16);

/** The earliest block at which `address` has code, or null if it is not a contract. */
export async function deploymentBlock(url: string, address: string, head: number) {
  // A spread of probes in one batch usually brackets the deployment immediately, because tokens
  // people look up are recent. Cheap calls, so they can all go together.
  const probes = [0, 0.5, 0.75, 0.875, 0.94, 0.97, 0.985, 0.995, 1].map((f) => Math.floor(head * f));
  const codes = (await rpcAll(
    url,
    probes.map((b) => ({ method: "eth_getCode", params: [address, hexBlock(b)] })),
  )) as (string | null | undefined)[];

  const present = codes.map((c) => (c ?? "0x").length > 2);
  if (!present[present.length - 1]) return null;
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

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await rpcOne<string>(url, "eth_getCode", [address, hexBlock(mid)]);
    if ((code ?? "0x").length > 2) hi = mid;
    else lo = mid;
  }
  return hi;
}
