import type { ProfitDeductionQuote, TradingTier } from "@/lib/types";

export const MIN_TRADING_TIER_CAPITAL_USD = 10;
export const BPS_DENOMINATOR = 10_000;

export const tradingTiers: TradingTier[] = [
  {
    id: "TIER 1",
    label: "$10 to $999",
    minCapitalUsd: 10,
    maxCapitalUsd: 999.99,
    profitDeductionBps: 2_000,
    profitDeductionPct: 20,
  },
  {
    id: "TIER 2",
    label: "$1,000 to $9,999",
    minCapitalUsd: 1_000,
    maxCapitalUsd: 9_999.99,
    profitDeductionBps: 1_200,
    profitDeductionPct: 12,
  },
  {
    id: "TIER 3",
    label: "$10,000 and above",
    minCapitalUsd: 10_000,
    maxCapitalUsd: null,
    profitDeductionBps: 850,
    profitDeductionPct: 8.5,
  },
];

export function resolveTradingTier(investedCapitalUsd: number) {
  if (!Number.isFinite(investedCapitalUsd) || investedCapitalUsd < MIN_TRADING_TIER_CAPITAL_USD) {
    return null;
  }

  return (
    tradingTiers.find((tier) => {
      const belowMax = tier.maxCapitalUsd === null || investedCapitalUsd <= tier.maxCapitalUsd;
      return investedCapitalUsd >= tier.minCapitalUsd && belowMax;
    }) || null
  );
}

export function calculateProfitDeductionUsd(grossProfitUsd: number, deductionBps: number) {
  const positiveProfitUsd = Math.max(0, Number.isFinite(grossProfitUsd) ? grossProfitUsd : 0);
  return Number(((positiveProfitUsd * deductionBps) / BPS_DENOMINATOR).toFixed(2));
}

export function quoteProfitDeduction(input: {
  investedCapitalUsd: number;
  grossProfitUsd: number;
}): ProfitDeductionQuote {
  const investedCapitalUsd = Number.isFinite(input.investedCapitalUsd) ? Math.max(0, input.investedCapitalUsd) : 0;
  const grossProfitUsd = Number.isFinite(input.grossProfitUsd) ? input.grossProfitUsd : 0;
  const tier = resolveTradingTier(investedCapitalUsd);

  if (!tier) {
    return {
      tier: null,
      investedCapitalUsd,
      grossProfitUsd,
      deductionUsd: 0,
      netProfitUsd: Number(grossProfitUsd.toFixed(2)),
      deductionBps: 0,
      deductionPct: 0,
      eligible: false,
      reason: "Invested capital must be at least $10 before a trading tier applies.",
    };
  }

  const deductionUsd = calculateProfitDeductionUsd(grossProfitUsd, tier.profitDeductionBps);

  return {
    tier,
    investedCapitalUsd,
    grossProfitUsd,
    deductionUsd,
    netProfitUsd: Number((grossProfitUsd - deductionUsd).toFixed(2)),
    deductionBps: tier.profitDeductionBps,
    deductionPct: tier.profitDeductionPct,
    eligible: true,
    reason:
      deductionUsd > 0
        ? `${tier.id} applies a ${tier.profitDeductionPct}% deduction to positive trade profit.`
        : `${tier.id} is active, with no deduction due when simulated profit is zero or negative.`,
  };
}

export function tierSummary() {
  return tradingTiers.map((tier) => ({
    ...tier,
    deductionLabel: `${tier.profitDeductionPct}%`,
  }));
}
