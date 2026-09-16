import { NextResponse } from "next/server";

/**
 * A same-origin relay for read-only JSON-RPC.
 *
 * WHY THE BROWSER DOES NOT TALK TO ARC DIRECTLY
 *
 * A visitor reported every contract read failing with empty data, while the same calls from the
 * same machine outside the browser succeeded — same DNS, same IP, same RPC. What differed was the
 * browser profile. Several wallet and "transaction safety" extensions intercept calls to RPC URLs
 * they recognise so they can simulate or scan them, and for a chain they do not support some
 * answer with an empty result rather than an error. To the app that is indistinguishable from
 * "no contract at this address".
 *
 * Routing reads through the site's own origin sidesteps that: an extension watching for known RPC
 * hosts sees a request to this site, not to Arc. It also means the browser never has to clear a
 * bot challenge on a third-party host.
 *
 * WHAT IT REFUSES
 *
 * Only read methods are forwarded. Transactions are signed and sent by the visitor's wallet
 * through its own provider and never come through here, so nothing that changes state is
 * allowed — an open relay would otherwise let anyone spend this deployment's RPC quota to
 * broadcast whatever they liked.
 */

export const runtime = "edge";

const UPSTREAM: Record<string, string> = {
  "5042": "https://rpc.mainnet.arc.io",
  "5042002": "https://rpc.testnet.arc.io",
};

const READ_METHODS = new Set([
  "eth_call",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getCode",
  "eth_getBalance",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "net_version",
  "web3_clientVersion",
]);

/** Generous for a multicall batch, tight enough that this cannot be used as a file upload. */
const MAX_BODY_BYTES = 512 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

function rejected(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const chain = url.searchParams.get("chain") ?? "5042";
  const upstream = UPSTREAM[chain];
  if (!upstream) {
    return NextResponse.json(rejected(null, -32600, "unknown chain"), { status: 400 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(rejected(null, -32600, "request too large"), { status: 413 });
  }

  let body: RpcRequest | RpcRequest[];
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(rejected(null, -32700, "parse error"), { status: 400 });
  }

  // Refuse the whole batch if any member is not a read. Forwarding the allowed ones and answering
  // the rest locally would leave a client with mixed provenance in one response, which is harder
  // to reason about than a clean refusal.
  const calls = Array.isArray(body) ? body : [body];
  const bad = calls.find((c) => typeof c?.method !== "string" || !READ_METHODS.has(c.method));
  if (bad) {
    const rejections = calls.map((c) =>
      rejected(c?.id, -32601, `method not relayed: ${String(bad.method)}`),
    );
    return NextResponse.json(Array.isArray(body) ? rejections : rejections[0], { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      signal: controller.signal,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        // Chain state changes every block; nothing here may be cached by a browser or a CDN.
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError";
    return NextResponse.json(
      rejected(null, -32000, timedOut ? "upstream timeout" : "upstream unreachable"),
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
