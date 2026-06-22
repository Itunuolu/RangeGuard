import type { HealthStatus, SuggestedActionType } from "@/lib/types";

export type PositionHealthInput = {
  lowerBin: number;
  upperBin: number;
  currentActiveBin: number | null;
  feesEarnedUsd: number;
  currentValueUsd: number;
  estimatedPnlPct: number;
};

export type PositionHealthResult = {
  status: HealthStatus;
  score: number;
  suggestedAction: SuggestedActionType;
  reason: string;
  distanceToEdgeBins: number | null;
};

export function evaluatePositionHealth(input: PositionHealthInput): PositionHealthResult {
  if (input.currentActiveBin === null) {
    return {
      status: "Out of range",
      score: 35,
      suggestedAction: "Rebalance",
      reason: "Current active bin is unavailable, so the position needs review before action.",
      distanceToEdgeBins: null,
    };
  }

  if (input.currentActiveBin < input.lowerBin || input.currentActiveBin > input.upperBin) {
    return {
      status: "Out of range",
      score: Math.max(10, 45 + Math.round(input.estimatedPnlPct)),
      suggestedAction: input.estimatedPnlPct < -12 ? "Exit" : "Rebalance",
      reason: "The active bin is outside the position range, so the position is not earning swap fees.",
      distanceToEdgeBins: 0,
    };
  }

  const distanceToLower = input.currentActiveBin - input.lowerBin;
  const distanceToUpper = input.upperBin - input.currentActiveBin;
  const distanceToEdgeBins = Math.min(distanceToLower, distanceToUpper);
  const width = Math.max(1, input.upperBin - input.lowerBin);
  const edgeRatio = distanceToEdgeBins / width;

  if (edgeRatio <= 0.15) {
    return {
      status: "Near edge",
      score: 58,
      suggestedAction: "Rebalance",
      reason: "The active bin is close to the range edge, so a small move could stop fee earning.",
      distanceToEdgeBins,
    };
  }

  if (input.feesEarnedUsd > Math.max(15, input.currentValueUsd * 0.015)) {
    return {
      status: "In range",
      score: 82,
      suggestedAction: "Claim fees",
      reason: "The position remains in range and accrued fees are above the monitoring threshold.",
      distanceToEdgeBins,
    };
  }

  return {
    status: "In range",
    score: 90,
    suggestedAction: "Hold",
    reason: "The active bin is comfortably inside the selected range.",
    distanceToEdgeBins,
  };
}
