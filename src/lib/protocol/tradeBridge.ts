import { quoteProfitDeduction } from "@/lib/protocol/tradingTiers";
import { simulateRange } from "@/lib/risk/simulator";
import type { Pool, WalletPoolBridgeSimulation } from "@/lib/types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function estimateGrossProfitUsd(pool: Pool, investedCapitalUsd: number, horizonDays: number) {
  const capital = Math.max(0, investedCapitalUsd);
  const annualizedFeeReturn = capital * (Math.max(0, pool.feeApr) / 100) * (horizonDays / 365);
  const riskDrag = annualizedFeeReturn * clamp(pool.riskScore / 420, 0.02, 0.24);
  const liquidityDrag = pool.liquidityUsd > 0 ? capital / pool.liquidityUsd : 1;
  const utilizationDrag = annualizedFeeReturn * clamp(liquidityDrag * 4, 0, 0.18);

  return Number((annualizedFeeReturn - riskDrag - utilizationDrag).toFixed(2));
}

export function simulateWalletPoolBridge(input: {
  walletAddress?: string | null;
  walletBalanceSol?: number | null;
  walletTokenAccounts?: number | null;
  pool: Pool;
  investedCapitalUsd: number;
  simulatedGrossProfitUsd?: number | null;
  horizonDays?: number;
}): WalletPoolBridgeSimulation {
  const walletAddress = input.walletAddress || null;
  const investedCapitalUsd = Math.max(0, finiteNumber(input.investedCapitalUsd, 0));
  const horizonDays = clamp(Math.round(finiteNumber(input.horizonDays, 30)), 1, 90);
  const range = simulateRange(input.pool, {
    depositAmountUsd: investedCapitalUsd,
    strategy: "Balanced",
    rangeWidth: "Medium",
    stopLossPct: 8,
    takeProfitPct: 25,
    autoCompound: false,
  });
  const simulatedGrossProfitUsd =
    input.simulatedGrossProfitUsd === null || input.simulatedGrossProfitUsd === undefined
      ? estimateGrossProfitUsd(input.pool, investedCapitalUsd, horizonDays)
      : Number(finiteNumber(input.simulatedGrossProfitUsd, 0).toFixed(2));
  const profitDeduction = quoteProfitDeduction({
    investedCapitalUsd,
    grossProfitUsd: simulatedGrossProfitUsd,
  });
  const liquidityUtilizationPct =
    input.pool.liquidityUsd > 0 ? Number(((investedCapitalUsd / input.pool.liquidityUsd) * 100).toFixed(4)) : 100;
  const estimatedSlippageBps = Math.round(
    clamp(8 + input.pool.riskScore * 0.35 + liquidityUtilizationPct * 6, 5, 250),
  );
  const estimatedPriceImpactPct = Number((estimatedSlippageBps / 100).toFixed(2));
  const walletBalanceSol = input.walletBalanceSol ?? null;
  const walletTokenAccounts = input.walletTokenAccounts ?? null;
  const syncChecks = [
    {
      id: "wallet-connected",
      label: "Wallet connected",
      passed: Boolean(walletAddress),
      detail: walletAddress ? "Connected wallet can review and sign prepared trades." : "Connect a wallet before preparing a trade.",
    },
    {
      id: "wallet-readable",
      label: "Wallet state readable",
      passed: walletBalanceSol !== null && walletTokenAccounts !== null,
      detail:
        walletBalanceSol !== null && walletTokenAccounts !== null
          ? `${walletBalanceSol.toFixed(4)} SOL and ${walletTokenAccounts} token account(s) detected.`
          : "Wallet balance and token accounts are unavailable in the current mode.",
    },
    {
      id: "trading-tier",
      label: "Trading tier assigned",
      passed: profitDeduction.eligible,
      detail: profitDeduction.tier
        ? `${profitDeduction.tier.id}: ${profitDeduction.tier.label}, ${profitDeduction.deductionPct}% profit deduction.`
        : profitDeduction.reason,
    },
    {
      id: "pool-active",
      label: "Pool active bin synced",
      passed: input.pool.activeBin !== null,
      detail:
        input.pool.activeBin !== null
          ? `Active bin ${input.pool.activeBin} is available for range simulation.`
          : "Active bin is unavailable, so trade synchronization cannot be trusted.",
    },
    {
      id: "pool-liquidity",
      label: "Pool liquidity supports size",
      passed: input.pool.liquidityUsd > 0 && liquidityUtilizationPct <= 2,
      detail: `${liquidityUtilizationPct.toFixed(4)}% of pool liquidity would be used by this capital amount.`,
    },
  ];

  return {
    walletAddress,
    walletBalanceSol,
    walletTokenAccounts,
    pool: input.pool,
    investedCapitalUsd,
    simulatedGrossProfitUsd,
    simulatedNetProfitUsd: profitDeduction.netProfitUsd,
    profitDeductionUsd: profitDeduction.deductionUsd,
    profitDeductionBps: profitDeduction.deductionBps,
    profitDeductionPct: profitDeduction.deductionPct,
    tradingTier: profitDeduction.tier,
    tokenARatio: range.estimatedTokenARatio,
    tokenBRatio: range.estimatedTokenBRatio,
    estimatedSlippageBps,
    estimatedPriceImpactPct,
    liquidityUtilizationPct,
    projectedFeeApr: input.pool.feeApr,
    routePlan: [
      "Connect wallet and read public balances",
      `Synchronize ${input.pool.tokenASymbol}/${input.pool.tokenBSymbol} pool state`,
      "Run LP range and profit simulation",
      "Apply capital tier deduction to positive profit",
      "Prepare wallet-confirmed trade preview",
    ],
    syncChecks,
    canPrepareTrade: syncChecks.every((check) => check.passed),
  };
}
