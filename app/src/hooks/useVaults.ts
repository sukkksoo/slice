"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { FACTORY_ADDRESS, factoryAbi, vaultAbi, erc20Abi } from "@/lib/contracts";
import { streamApr, tokenValueInUsdc } from "@/lib/format";

export type VaultSummary = {
  address: Address;
  /** The underlying asset's ticker, e.g. "DTT" — what a person means by "the pool". */
  symbol: string;
  /** The vault share token's own symbol, e.g. "dLP-DTT". */
  shareSymbol: string;
  assetToken: Address;
  usdcIsCurrency0: boolean;
  totalSupply: bigint;
  totalLiquidity: bigint;
  /** Underlying backing the whole share supply, split by role. */
  usdcHeld: bigint;
  assetHeld: bigint;
  /** Total value locked, in 6-decimal USDC. */
  tvlUsdc: bigint;
  sqrtPriceX96: bigint;
  oracleWarm: boolean;
  rewardRate: bigint;
  periodFinish: bigint;
  pendingCompound: bigint;
  protocolFeeBps: number;
  streamBps: number;
  aprPercent: number;
  /** Connected wallet's position, when a wallet is connected. */
  userShares: bigint;
  userEarned: bigint;
};

/** Per-vault calls, in a fixed order so the decoder below can stay positional. */
const VAULT_FIELDS = [
  "symbol",
  "assetCurrency",
  "usdcIsCurrency0",
  "totalSupply",
  "totalLiquidity",
  "prices",
  "rewardRate",
  "periodFinish",
  "pendingCompound",
  "protocolFeeBps",
  "streamBps",
] as const;

const FIELD_COUNT = VAULT_FIELDS.length;
/** previewRedeem + balanceOf + earned are appended after the fixed fields. */
const EXTRA_COUNT = 3;
const CALLS_PER_VAULT = FIELD_COUNT + EXTRA_COUNT;

export function useVaultAddresses() {
  const enabled = Boolean(FACTORY_ADDRESS);

  const countQuery = useReadContract({
    address: FACTORY_ADDRESS as Address,
    abi: factoryAbi,
    functionName: "vaultCount",
    query: { enabled },
  });

  const count = Number((countQuery.data as bigint | undefined) ?? 0n);

  const listQuery = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: FACTORY_ADDRESS as Address,
      abi: factoryAbi,
      functionName: "allVaults",
      args: [BigInt(i)],
    })),
    query: { enabled: enabled && count > 0 },
  });

  const addresses = useMemo(
    () =>
      (listQuery.data ?? [])
        .map((r) => (r.status === "success" ? (r.result as Address) : null))
        .filter((a): a is Address => a !== null),
    [listQuery.data],
  );

  return {
    addresses,
    count,
    isLoading: countQuery.isLoading || listQuery.isLoading,
    error: countQuery.error ?? listQuery.error,
    configured: enabled,
  };
}

export function useVaults() {
  const { address: account } = useAccount();
  const { addresses, isLoading: listLoading, error, configured } = useVaultAddresses();

  // A sentinel keeps the call layout identical whether or not a wallet is connected, so the
  // positional decoding below does not have to branch.
  const holder = account ?? ("0x0000000000000000000000000000000000000000" as Address);

  const contracts = useMemo(
    () =>
      addresses.flatMap((vault) => {
        const base = VAULT_FIELDS.map((functionName) => ({
          address: vault,
          abi: vaultAbi,
          functionName,
        }));
        return [
          ...base,
          // previewRedeem(totalSupply) is filled in on the second pass; pass 0 here and correct
          // it below using totalSupply, which we only learn from this same batch.
          { address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [0n] },
          { address: vault, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
          { address: vault, abi: vaultAbi, functionName: "earned", args: [holder] },
        ];
      }),
    [addresses, holder],
  );

  const batch = useReadContracts({
    contracts,
    query: { enabled: addresses.length > 0, refetchInterval: 15_000 },
  });

  // Second pass: now that totalSupply is known, ask what the full supply redeems for. That is the
  // vault's entire underlying position, which is what TVL means here.
  const supplies = useMemo(() => {
    const rows = batch.data;
    if (!rows) return [];
    return addresses.map((_, i) => {
      const r = rows[i * CALLS_PER_VAULT + 3];
      return r?.status === "success" ? (r.result as bigint) : 0n;
    });
  }, [batch.data, addresses]);

  const redeemBatch = useReadContracts({
    contracts: addresses.map((vault, i) => ({
      address: vault,
      abi: vaultAbi,
      functionName: "previewRedeem",
      args: [supplies[i] ?? 0n],
    })),
    query: { enabled: supplies.length > 0 && supplies.some((s) => s > 0n), refetchInterval: 15_000 },
  });

  const vaults = useMemo<VaultSummary[]>(() => {
    const rows = batch.data;
    if (!rows) return [];

    return addresses.flatMap((address, i) => {
      const at = (offset: number) => rows[i * CALLS_PER_VAULT + offset];
      const ok = (offset: number) => at(offset)?.status === "success";
      if (!ok(0)) return [];

      // The vault names its share token `dLP-<asset>`; strip that so the UI shows the pool the
      // person recognises rather than the wrapper.
      const shareSymbol = at(0)!.result as string;
      const symbol = shareSymbol.replace(/^dLP-/, "");
      const assetToken = at(1)!.result as Address;
      const usdcIsCurrency0 = at(2)!.result as boolean;
      const totalSupply = (at(3)?.result as bigint) ?? 0n;
      const totalLiquidity = (at(4)?.result as bigint) ?? 0n;

      const prices = at(5)?.result as [boolean, bigint, bigint] | undefined;
      const oracleWarm = prices?.[0] ?? false;
      const sqrtPriceX96 = prices?.[1] ?? 0n;

      const rewardRate = (at(6)?.result as bigint) ?? 0n;
      const periodFinish = (at(7)?.result as bigint) ?? 0n;
      const pendingCompound = (at(8)?.result as bigint) ?? 0n;
      const protocolFeeBps = Number((at(9)?.result as number | bigint) ?? 0);
      const streamBps = Number((at(10)?.result as number | bigint) ?? 0);

      const userShares = (at(FIELD_COUNT + 1)?.result as bigint) ?? 0n;
      const userEarned = (at(FIELD_COUNT + 2)?.result as bigint) ?? 0n;

      const redeemRow = redeemBatch.data?.[i];
      const [amount0, amount1] =
        redeemRow?.status === "success" ? (redeemRow.result as [bigint, bigint]) : [0n, 0n];

      const usdcHeld = usdcIsCurrency0 ? amount0 : amount1;
      const assetHeld = usdcIsCurrency0 ? amount1 : amount0;
      const tvlUsdc = usdcHeld + tokenValueInUsdc(assetHeld, sqrtPriceX96, usdcIsCurrency0);

      return [
        {
          address,
          symbol,
          shareSymbol,
          assetToken,
          usdcIsCurrency0,
          totalSupply,
          totalLiquidity,
          usdcHeld,
          assetHeld,
          tvlUsdc,
          sqrtPriceX96,
          oracleWarm,
          rewardRate,
          periodFinish,
          pendingCompound,
          protocolFeeBps,
          streamBps,
          aprPercent: streamApr(rewardRate, tvlUsdc, periodFinish),
          userShares,
          userEarned,
        },
      ];
    });
  }, [batch.data, redeemBatch.data, addresses]);

  return {
    vaults,
    isLoading: listLoading || batch.isLoading,
    error: error ?? batch.error,
    configured,
    refetch: () => {
      void batch.refetch();
      void redeemBatch.refetch();
    },
  };
}
