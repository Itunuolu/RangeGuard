import type { Pool, RangeWidth, StrategyRiskLevel } from "@/lib/types";

export type SimulatorInput = {
  depositAmountUsd: number;
  strategy: StrategyRiskLevel;
  rangeWidth: RangeWidth;
  stopLossPct: number;
  takeProfitPct: number;
  autoCompound: boolean;
};

export type SimulatorResult = {
  lowerBin: number;
  upperBin: number;
  estimatedTokenARatio: number;
  estimatedTokenBRatio: number;
  rangeHealth: string;
  riskWarning: string;
  previewItems: Array<{ label: string; value: string }>;
};

const widthBins: Record<RangeWidth, number> = {
  Tight: 18,
  Medium: 42,
  Wide: 82,
};

const strategyMultiplier: Record<StrategyRiskLevel, number> = {
  Conservative: 1.45,
  Balanced: 1,
  Aggressive: 0.62,
};

export function simulateRange(pool: Pool, input: SimulatorInput): SimulatorResult {
  const activeBin = pool.activeBin ?? 8_388_608;
  const span = Math.max(8, Math.round(widthBins[input.rangeWidth] * strategyMultiplier[input.strategy]));
  const lowerBin = activeBin - Math.floor(span / 2);
  const upperBin = activeBin + Math.ceil(span / 2);

  const stableBias = pool.poolType === "Stable" ? 0.5 : input.strategy === "Aggressive" ? 0.58 : 0.52;
  const riskPenalty = pool.riskScore >= 70 ? 0.08 : pool.riskScore >= 50 ? 0.04 : 0;
  const estimatedTokenARatio = Math.max(0.35, Math.min(0.65, stableBias - riskPenalty));
  const estimatedTokenBRatio = 1 - estimatedTokenARatio;

  const rangeHealth =
    input.strategy === "Conservative"
      ? "Wider range reduces out-of-range risk, usually with lower capital efficiency."
      : input.strategy === "Aggressive"
        ? "Tighter range may earn more fees while active, but needs closer monitoring."
        : "Balanced range keeps moderate fee exposure with manageable rebalance frequency.";

  const warnings: string[] = [];
  if (pool.riskLabel === "High" || pool.riskLabel === "Avoid") {
    warnings.push("Pool risk is elevated; consider smaller sizing or a safer pool.");
  }
  if (input.stopLossPct > 0 && input.stopLossPct < 5) {
    warnings.push("Very tight stop loss settings can trigger frequent manual reviews.");
  }
  if (input.autoCompound) {
    warnings.push("Auto-compound is recorded as a future preference only and will not execute.");
  }

  return {
    lowerBin,
    upperBin,
    estimatedTokenARatio,
    estimatedTokenBRatio,
    rangeHealth,
    riskWarning:
      warnings.join(" ") ||
      "Simulation is an estimate, not a guarantee. Wallet confirmation is required before any transaction.",
    previewItems: [
      { label: "Deposit", value: `$${input.depositAmountUsd.toLocaleString()}` },
      { label: "Bin span", value: `${span} bins` },
      { label: `${pool.tokenASymbol} ratio`, value: `${Math.round(estimatedTokenARatio * 100)}%` },
      { label: `${pool.tokenBSymbol} ratio`, value: `${Math.round(estimatedTokenBRatio * 100)}%` },
      { label: "Stop loss", value: `${input.stopLossPct}%` },
      { label: "Take profit", value: `${input.takeProfitPct}%` },
    ],
  };
}
