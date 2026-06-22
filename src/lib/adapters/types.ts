import type { Pool, Position } from "@/lib/types";

export type PoolFilters = {
  stableOnly?: boolean;
  minLiquidityUsd?: number;
  minVolume24hUsd?: number;
  riskLabel?: string;
};

export type MeteoraDlmmAdapter = {
  listPools(filters?: PoolFilters): Promise<Pool[]>;
  getPool(poolAddress: string): Promise<Pool | null>;
  getUserPositions(walletAddress: string): Promise<Position[]>;
};

export type JupiterQuoteRequest = {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  taker?: string;
};

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: string[];
  warning: string;
};

export type JupiterAdapter = {
  getQuote(request: JupiterQuoteRequest): Promise<JupiterQuote>;
};

export type SolanaRpcAdapter = {
  getWalletBalance(walletAddress: string): Promise<number>;
  getTokenAccountCount(walletAddress: string): Promise<number>;
};
