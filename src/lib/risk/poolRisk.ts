import type { RiskLabel } from "@/lib/types";

export type PoolRiskInput = {
  liquidityUsd: number;
  volume24hUsd: number;
  feeApr: number;
  volatilityScore: number;
  tokenRiskScore: number;
  historicalDays?: number;
  isStablePair?: boolean;
};

export type RiskReason = {
  label: string;
  points: number;
  explanation: string;
};

export type PoolRiskResult = {
  score: number;
  label: RiskLabel;
  reasons: RiskReason[];
  summary: string;
};

function labelFromScore(score: number): RiskLabel {
  if (score <= 25) return "Low";
  if (score <= 50) return "Medium";
  if (score <= 75) return "High";
  return "Avoid";
}

export function scorePool(poolInput: PoolRiskInput): PoolRiskResult {
  const reasons: RiskReason[] = [];
  let score = 8;

  if (poolInput.isStablePair) {
    score -= 6;
    reasons.push({
      label: "Stable pair",
      points: -6,
      explanation: "Both sides behave like stable or blue-chip assets, reducing range drift risk.",
    });
  }

  if (poolInput.liquidityUsd < 100_000) {
    score += 30;
    reasons.push({
      label: "Thin liquidity",
      points: 30,
      explanation: "Liquidity is below $100k, so price impact and position exit risk are elevated.",
    });
  } else if (poolInput.liquidityUsd < 1_000_000) {
    score += 18;
    reasons.push({
      label: "Moderate liquidity",
      points: 18,
      explanation: "Liquidity is below $1m, which can make active ranges fragile.",
    });
  } else if (poolInput.liquidityUsd > 10_000_000) {
    score -= 5;
    reasons.push({
      label: "Deep liquidity",
      points: -5,
      explanation: "The pool has enough liquidity to reduce execution and exit risk.",
    });
  }

  const volumeToLiquidity = poolInput.liquidityUsd > 0 ? poolInput.volume24hUsd / poolInput.liquidityUsd : 0;
  if (volumeToLiquidity > 2) {
    score += 20;
    reasons.push({
      label: "Hot volume",
      points: 20,
      explanation: "24h volume is more than 2x liquidity, which may indicate unstable flow.",
    });
  } else if (volumeToLiquidity > 1) {
    score += 10;
    reasons.push({
      label: "High utilization",
      points: 10,
      explanation: "High volume relative to liquidity can earn fees but also increases range risk.",
    });
  } else if (volumeToLiquidity < 0.05) {
    score += 6;
    reasons.push({
      label: "Low activity",
      points: 6,
      explanation: "Very low volume can leave positions earning little despite supplied capital.",
    });
  }

  const volatilityPoints = Math.round(poolInput.volatilityScore * 0.28);
  score += volatilityPoints;
  reasons.push({
    label: "Volatility",
    points: volatilityPoints,
    explanation: `Volatility score contributes ${volatilityPoints} risk points to range management.`,
  });

  const tokenPoints = Math.round(poolInput.tokenRiskScore * 0.22);
  score += tokenPoints;
  reasons.push({
    label: "Token risk",
    points: tokenPoints,
    explanation: "Token maturity, market depth, and metadata quality affect pool risk.",
  });

  if (poolInput.feeApr > 150) {
    score += 15;
    reasons.push({
      label: "Extreme APR signal",
      points: 15,
      explanation: "Very high fee APR can be a warning sign for volatile or short-lived conditions.",
    });
  } else if (poolInput.feeApr > 75) {
    score += 8;
    reasons.push({
      label: "Elevated APR signal",
      points: 8,
      explanation: "High fee APR deserves extra review before sizing a position.",
    });
  }

  if (typeof poolInput.historicalDays === "number" && poolInput.historicalDays < 30) {
    score += 12;
    reasons.push({
      label: "Limited history",
      points: 12,
      explanation: "The pool has less than 30 days of history, so the risk estimate is less reliable.",
    });
  }

  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  const label = labelFromScore(normalized);
  const positiveReason = reasons.find((reason) => reason.points > 0);
  const summary =
    label === "Low"
      ? "Stable pair with lower volatility and stronger liquidity."
      : positiveReason?.explanation || "Risk is driven by liquidity, volatility, and token metadata.";

  return {
    score: normalized,
    label,
    reasons,
    summary,
  };
}
