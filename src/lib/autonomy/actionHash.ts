import { createHash } from "node:crypto";

import type { BotAction, BotPolicy } from "@/lib/types";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

export function sha256Hex(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue(payload))).digest("hex");
}

export function hashBotPolicy(policy: BotPolicy) {
  return sha256Hex({
    id: policy.id,
    userId: policy.userId,
    mode: policy.mode,
    executionMode: policy.executionMode,
    maxPositionSizeUsd: policy.maxPositionSizeUsd,
    dailyNotionalLimitUsd: policy.dailyNotionalLimitUsd,
    maxSlippageBps: policy.maxSlippageBps,
    maxPoolRiskScore: policy.maxPoolRiskScore,
    minPoolLiquidityUsd: policy.minPoolLiquidityUsd,
    maxOpenPositions: policy.maxOpenPositions,
    dailyRebalanceLimit: policy.dailyRebalanceLimit,
    stopLossPct: policy.stopLossPct,
    takeProfitPct: policy.takeProfitPct,
    allowedPoolTypes: policy.allowedPoolTypes,
    allowedPoolAddresses: policy.allowedPoolAddresses,
    requireSimulation: policy.requireSimulation,
    requireWalletConfirm: policy.requireWalletConfirm,
    guardProgramId: policy.guardProgramId,
    onChainPolicyAddress: policy.onChainPolicyAddress,
    delegatedAuthority: policy.delegatedAuthority,
    riskAuthority: policy.riskAuthority,
  });
}

export function hashBotAction(action: BotAction) {
  return sha256Hex({
    id: action.id,
    userId: action.userId,
    policyId: action.policyId,
    positionId: action.positionId,
    type: action.type,
    protocol: action.protocol,
    notionalUsd: action.notionalUsd,
    estimatedSlippageBps: action.estimatedSlippageBps,
    simulatedGrossProfitUsd: action.simulatedGrossProfitUsd || 0,
    proposedLowerBin: action.proposedLowerBin,
    proposedUpperBin: action.proposedUpperBin,
    targetProgramIds: action.transactionPlan.targetProgramIds,
    targetInstructionDigest: action.transactionPlan.targetInstructionDigest || null,
    guardProgramId: action.transactionPlan.guardProgramId,
    onChainPolicyAddress: action.transactionPlan.onChainPolicyAddress,
  });
}
