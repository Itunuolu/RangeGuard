import { serverConfig } from "@/lib/config";
import { invalidProgramIds, validProgramIds } from "@/lib/autonomy/programs";
import type { BotAction, BotPolicy, GuardrailResult, Position } from "@/lib/types";

export type GuardrailContext = {
  policy: BotPolicy;
  position?: Position;
  actionType: BotAction["type"];
  notionalUsd: number;
  estimatedSlippageBps: number;
  projectedDailyNotionalUsd: number;
  openPositions: number;
  rebalancesToday: number;
};

export function getProtocolReadiness(policy: BotPolicy) {
  const blockers: string[] = [];
  const allowedProgramIds = validProgramIds(serverConfig.autonomyAllowedProgramIds);
  const invalidPrograms = invalidProgramIds(serverConfig.autonomyAllowedProgramIds);

  if (!serverConfig.autonomyExecutionEnabled) {
    blockers.push("AUTONOMY_EXECUTION_ENABLED is false.");
  }

  if (!serverConfig.autonomyGuardProgramId && !policy.guardProgramId) {
    blockers.push("No audited autonomy guard program is configured.");
  }

  if (!serverConfig.autonomyPolicyAddress && !policy.onChainPolicyAddress) {
    blockers.push("No on-chain policy account is configured.");
  }

  if (!serverConfig.autonomyKeeperAuthority && !policy.delegatedAuthority) {
    blockers.push("No keeper/delegated authority is configured.");
  }

  if (!serverConfig.autonomyRiskAuthority && !policy.riskAuthority) {
    blockers.push("No independent risk authority is configured.");
  }

  if (!serverConfig.autonomyKeeperSignerUrl) {
    blockers.push("No remote keeper signer endpoint is configured.");
  }

  if (allowedProgramIds.length === 0) {
    blockers.push("No valid target program allowlist is configured.");
  }

  if (invalidPrograms.length > 0) {
    blockers.push(`Invalid allowed program id(s): ${invalidPrograms.join(", ")}.`);
  }

  if (policy.status !== "Armed") {
    blockers.push("Policy status is not Armed.");
  }

  if (policy.executionMode !== "DelegatedGuarded") {
    blockers.push("Policy execution mode is not DelegatedGuarded.");
  }

  if (policy.requireWalletConfirm) {
    blockers.push("Policy still requires wallet confirmation for each action.");
  }

  return {
    executionEnabled: serverConfig.autonomyExecutionEnabled,
    guardProgramConfigured: Boolean(serverConfig.autonomyGuardProgramId || policy.guardProgramId),
    keeperConfigured: Boolean(serverConfig.autonomyKeeperAuthority || policy.delegatedAuthority),
    riskAuthorityConfigured: Boolean(serverConfig.autonomyRiskAuthority || policy.riskAuthority),
    policyAccountConfigured: Boolean(serverConfig.autonomyPolicyAddress || policy.onChainPolicyAddress),
    remoteSignerConfigured: Boolean(serverConfig.autonomyKeeperSignerUrl),
    allowedProgramsConfigured: allowedProgramIds.length > 0 && invalidPrograms.length === 0,
    canExecuteAutonomously: blockers.length === 0,
    blockers,
  };
}

export function evaluateGuardrails(context: GuardrailContext): GuardrailResult[] {
  const { policy, position } = context;
  const pool = position?.pool;

  return [
    {
      id: "position-size",
      label: "Position size cap",
      passed: context.notionalUsd <= policy.maxPositionSizeUsd,
      detail: `${context.notionalUsd.toLocaleString()} USD requested vs ${policy.maxPositionSizeUsd.toLocaleString()} USD max.`,
    },
    {
      id: "daily-notional",
      label: "Daily notional cap",
      passed: context.projectedDailyNotionalUsd <= policy.dailyNotionalLimitUsd,
      detail: `${context.projectedDailyNotionalUsd.toLocaleString()} USD projected vs ${policy.dailyNotionalLimitUsd.toLocaleString()} USD daily cap.`,
    },
    {
      id: "slippage",
      label: "Slippage cap",
      passed: context.estimatedSlippageBps <= policy.maxSlippageBps,
      detail: `${context.estimatedSlippageBps} bps estimated vs ${policy.maxSlippageBps} bps max.`,
    },
    {
      id: "pool-risk",
      label: "Pool risk cap",
      passed: !pool || pool.riskScore <= policy.maxPoolRiskScore,
      detail: pool ? `${pool.riskScore}/100 pool risk vs ${policy.maxPoolRiskScore}/100 max.` : "No pool risk context required.",
    },
    {
      id: "pool-liquidity",
      label: "Liquidity floor",
      passed: !pool || pool.liquidityUsd >= policy.minPoolLiquidityUsd,
      detail: pool ? `$${pool.liquidityUsd.toLocaleString()} liquidity vs $${policy.minPoolLiquidityUsd.toLocaleString()} minimum.` : "No pool liquidity context required.",
    },
    {
      id: "pool-type",
      label: "Allowed pool type",
      passed: !pool || policy.allowedPoolTypes.includes(pool.poolType),
      detail: pool ? `${pool.poolType} pool type checked against policy allowlist.` : "No pool type context required.",
    },
    {
      id: "open-positions",
      label: "Open position limit",
      passed: context.openPositions <= policy.maxOpenPositions,
      detail: `${context.openPositions} open positions vs ${policy.maxOpenPositions} max.`,
    },
    {
      id: "rebalance-limit",
      label: "Daily rebalance limit",
      passed: context.actionType !== "Rebalance" || context.rebalancesToday < policy.dailyRebalanceLimit,
      detail: `${context.rebalancesToday} rebalances today vs ${policy.dailyRebalanceLimit} max.`,
    },
  ];
}

export function guardrailsPassed(results: GuardrailResult[]) {
  return results.every((result) => result.passed);
}
