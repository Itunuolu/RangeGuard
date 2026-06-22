import { Connection, PublicKey } from "@solana/web3.js";

import { serverConfig } from "@/lib/config";
import { mockPools, mockPositions } from "@/lib/mock/data";
import { scorePool } from "@/lib/risk/poolRisk";
import type { MeteoraDlmmAdapter, PoolFilters } from "@/lib/adapters/types";
import type { Pool } from "@/lib/types";

function applyPoolFilters(pools: Pool[], filters?: PoolFilters) {
  return pools.filter((pool) => {
    if (filters?.stableOnly && pool.poolType !== "Stable") return false;
    if (filters?.minLiquidityUsd && pool.liquidityUsd < filters.minLiquidityUsd) return false;
    if (filters?.minVolume24hUsd && pool.volume24hUsd < filters.minVolume24hUsd) return false;
    if (filters?.riskLabel && filters.riskLabel !== "All" && pool.riskLabel !== filters.riskLabel) return false;
    return true;
  });
}

const mockMeteoraAdapter: MeteoraDlmmAdapter = {
  async listPools(filters) {
    return applyPoolFilters(mockPools, filters);
  },
  async getPool(poolAddress) {
    return mockPools.find((pool) => pool.poolAddress === poolAddress) ?? null;
  },
  async getUserPositions() {
    return mockPositions;
  },
};

function mapMeteoraApiPair(pair: Record<string, unknown>, index: number): Pool | null {
  const address = String(pair.address || pair.publicKey || pair.pool_address || "");
  if (!address) return null;

  const tokenX = (pair.mint_x || pair.token_x || pair.tokenA || {}) as Record<string, unknown>;
  const tokenY = (pair.mint_y || pair.token_y || pair.tokenB || {}) as Record<string, unknown>;
  const tokenASymbol = String(pair.token_x_symbol || tokenX.symbol || pair.name || "TOKENA").split("-")[0] || "TOKENA";
  const tokenBSymbol = String(pair.token_y_symbol || tokenY.symbol || "TOKENB");
  const liquidityUsd = Number(pair.liquidity || pair.liquidity_usd || pair.tvl || 0);
  const volume24hUsd = Number(pair.trade_volume_24h || pair.volume24h || pair.volume_24h || 0);
  const feeApr =
    Number(pair.apr || pair.fee_apr || 0) ||
    (pair.fees_24h && liquidityUsd > 0 ? (Number(pair.fees_24h) * 365 * 100) / liquidityUsd : 0);
  const volatilityScore = Math.min(100, Math.max(10, Math.round((volume24hUsd / Math.max(liquidityUsd, 1)) * 42)));
  const tokenRiskScore = tokenASymbol.includes("USD") && tokenBSymbol.includes("USD") ? 12 : 28;
  const risk = scorePool({
    liquidityUsd,
    volume24hUsd,
    feeApr,
    volatilityScore,
    tokenRiskScore,
    historicalDays: 90,
    isStablePair: tokenASymbol.includes("USD") && tokenBSymbol.includes("USD"),
  });

  return {
    id: `meteora-real-${index}`,
    poolAddress: address,
    protocol: "Meteora DLMM",
    tokenAMint: String(pair.mint_x || pair.token_x_mint || ""),
    tokenBMint: String(pair.mint_y || pair.token_y_mint || ""),
    tokenASymbol,
    tokenBSymbol,
    liquidityUsd,
    volume24hUsd,
    feeApr,
    volatilityScore,
    riskScore: risk.score,
    riskLabel: risk.label,
    riskReasons: [risk.summary, ...risk.reasons.filter((reason) => reason.points > 0).slice(0, 2).map((reason) => reason.explanation)],
    activeBin: typeof pair.active_bin_id === "number" ? pair.active_bin_id : null,
    poolType: tokenASymbol.includes("USD") && tokenBSymbol.includes("USD") ? "Stable" : "Any",
    tokenRiskScore,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastScannedAt: new Date().toISOString(),
    liquidityHistory: mockPools[index % mockPools.length].liquidityHistory,
    volumeHistory: mockPools[index % mockPools.length].volumeHistory,
    feeHistory: mockPools[index % mockPools.length].feeHistory,
  };
}

const realMeteoraAdapter: MeteoraDlmmAdapter = {
  async listPools(filters) {
    try {
      const response = await fetch("https://dlmm-api.meteora.ag/pair/all");
      if (!response.ok) throw new Error(`Meteora pair API returned ${response.status}`);
      const body = (await response.json()) as unknown;
      const rawPairs = Array.isArray(body) ? body : Array.isArray((body as { pairs?: unknown[] }).pairs) ? (body as { pairs: unknown[] }).pairs : [];
      const mapped = rawPairs
        .slice(0, 40)
        .map((pair, index) => mapMeteoraApiPair(pair as Record<string, unknown>, index))
        .filter(Boolean) as Pool[];
      return applyPoolFilters(mapped.length ? mapped : mockPools, filters);
    } catch {
      return applyPoolFilters(mockPools, filters);
    }
  },
  async getPool(poolAddress) {
    try {
      const connection = new Connection(serverConfig.solanaRpcUrl, "confirmed");
      const dlmmModule = (await import("@meteora-ag/dlmm")) as unknown as {
        default?: { create: (connection: Connection, key: PublicKey) => Promise<{ getActiveBin: () => Promise<{ binId: number }> }> };
        DLMM?: { create: (connection: Connection, key: PublicKey) => Promise<{ getActiveBin: () => Promise<{ binId: number }> }> };
      };
      const dlmmFactory = dlmmModule.default || dlmmModule.DLMM;
      const dlmmPool = await dlmmFactory?.create(connection, new PublicKey(poolAddress));
      const activeBin = await dlmmPool?.getActiveBin();
      const fromList = (await this.listPools()).find((pool) => pool.poolAddress === poolAddress);
      if (!fromList) return null;
      return { ...fromList, activeBin: activeBin?.binId ?? fromList.activeBin };
    } catch {
      return mockPools.find((pool) => pool.poolAddress === poolAddress) ?? null;
    }
  },
  async getUserPositions(walletAddress) {
    try {
      new PublicKey(walletAddress);
      // TODO: Replace this fallback with DLMM SDK `getPositionsByUserAndLbPair` once the user has selected
      // a concrete pair. The SDK docs expose position lookup by owner and pool, but discovery across all
      // pools should be indexed server-side for production.
      return mockPositions;
    } catch {
      return mockPositions;
    }
  },
};

export function getMeteoraDlmmAdapter(): MeteoraDlmmAdapter {
  return serverConfig.mockMode ? mockMeteoraAdapter : realMeteoraAdapter;
}
