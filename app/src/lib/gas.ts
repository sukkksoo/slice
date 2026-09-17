import type { Abi, Address } from "viem";

/**
 * A gas limit with enough headroom to survive the block it lands in.
 *
 * `eth_estimateGas` answers with the *minimum* that works against the state it simulated. That is
 * a boundary, not a budget, and wallets add very little to it — MetaMask sent 263,056 against an
 * estimate of 262,898 on Arc, a margin of 0.1%.
 *
 * Two things here make that margin too thin to survive:
 *
 *   - Every call that moves USDC goes through Arc's compliance precompile, nested inside
 *     `take` -> `transfer` -> precompile. A call may only pass on 63/64 of the gas it has left, so
 *     a limit that is nominally sufficient can still starve the innermost frame while the outer
 *     one sits on the 1/64 it was obliged to keep.
 *   - The estimate is taken against one state and the transaction executes against another. A
 *     withdrawal died on exactly this: sixteen transactions landed ahead of it in the same block,
 *     left different storage warm, and it consumed 258,586 of its 263,056 before the sub-call ran
 *     dry. Nothing was wrong with the call — it succeeded when replayed one block earlier.
 *
 * Unused gas is refunded and none of this is a bid, so the buffer costs nothing when it is not
 * needed. A failed transaction, by contrast, costs every unit it burned and returns nothing.
 */
const BUFFER_NUMERATOR = 13n;
const BUFFER_DENOMINATOR = 10n;

type EstimatingClient = {
  estimateContractGas: (args: never) => Promise<bigint>;
};

export async function bufferedGas(
  client: EstimatingClient | undefined,
  call: {
    address: Address;
    abi: Abi | readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    account: Address;
  },
): Promise<bigint | undefined> {
  if (!client) return undefined;
  try {
    const estimate = await client.estimateContractGas(call as never);
    return (estimate * BUFFER_NUMERATOR) / BUFFER_DENOMINATOR;
  } catch {
    // An estimate can fail for reasons that do not stop the transaction — a node refusing the
    // request, most often. Returning undefined leaves the wallet to its own estimate, which is
    // the behaviour this replaces rather than something worse than it.
    return undefined;
  }
}
