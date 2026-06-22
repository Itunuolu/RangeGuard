import { evaluatePositionHealth } from "@/lib/risk/positionHealth";
import { attachGuardPlan } from "@/lib/autonomy/guardProgram";
import { evaluateGuardrails, getProtocolReadiness, guardrailsPassed } from "@/lib/autonomy/policy";
import type { BotAction, BotControlPlane, BotPolicy, BotRun, CopyLpTarget, Position } from "@/lib/types";

type PlanInput = {
  userId: string;
  policy: BotPolicy;
  positions: Position[];
  copyTargets: CopyLpTarget[];
};

const startedAt = "2026-05-22T09:00:00.000Z";

function actionTypeForSuggestion(suggestion: Position["suggestedAction"]): BotAction["type"] | null {
  if (suggestion === "Claim fees") return "ClaimFees";
  if (suggestion === "Rebalance") return "Rebalance";
  if (suggestion === "Exit") return "ClosePosition";
  return null;
}

function titleForAction(actionType: BotAction["type"], position: Position) {
  if (actionType === "ClaimFees") return `Claim fees on ${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`;
  if (actionType === "Rebalance") return `Rebalance ${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`;
  if (actionType === "ClosePosition") return `Close ${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`;
  return `Open ${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`;
}

export function planAutonomyRun(input: PlanInput): BotControlPlane {
  const openPositions = input.positions.filter((position) => position.status === "Open");
  const rebalancesToday = 1;
  let projectedDailyNotionalUsd = 0;
  const readiness = getProtocolReadiness(input.policy);

  const actions = openPositions.flatMap((position, index) => {
    const health = evaluatePositionHealth({
      lowerBin: position.lowerBin,
      upperBin: position.upperBin,
      currentActiveBin: position.currentActiveBin,
      feesEarnedUsd: position.feesEarnedUsd,
      currentValueUsd: position.currentValueUsd,
      estimatedPnlPct: position.estimatedPnlPct,
    });
    const actionType = actionTypeForSuggestion(health.suggestedAction);
    if (!actionType) return [];

    const notionalUsd =
      actionType === "ClaimFees" ? Math.max(0, position.feesEarnedUsd) : Math.max(0, position.currentValueUsd);
    const simulatedGrossProfitUsd =
      actionType === "ClaimFees"
        ? Math.max(0, position.feesEarnedUsd)
        : Math.max(0, position.estimatedPnlUsd + position.feesEarnedUsd);
    const estimatedSlippageBps = actionType === "Rebalance" ? 42 : actionType === "ClosePosition" ? 55 : 0;
    projectedDailyNotionalUsd += notionalUsd;
    const proposedLowerBin =
      actionType === "Rebalance" && position.currentActiveBin !== null ? position.currentActiveBin - 40 : null;
    const proposedUpperBin =
      actionType === "Rebalance" && position.currentActiveBin !== null ? position.currentActiveBin + 40 : null;

    const guardrailResults = evaluateGuardrails({
      policy: input.policy,
      position,
      actionType,
      notionalUsd,
      estimatedSlippageBps,
      projectedDailyNotionalUsd,
      openPositions: openPositions.length,
      rebalancesToday,
    });
    const allowedByPolicy = guardrailsPassed(guardrailResults);
    const status: BotAction["status"] = !allowedByPolicy
      ? "Blocked"
      : readiness.canExecuteAutonomously
        ? "Queued"
        : "NeedsWallet";
    const executionStatus: BotAction["executionStatus"] = readiness.canExecuteAutonomously
      ? "Ready"
      : input.policy.requireWalletConfirm
        ? "AwaitingWallet"
        : !readiness.policyAccountConfigured
          ? "PolicyMissing"
          : !readiness.remoteSignerConfigured
            ? "KeeperMissing"
            : "DelegationMissing";

    const action = {
        id: `bot-action-${position.id}-${actionType.toLowerCase()}`,
        userId: input.userId,
        policyId: input.policy.id,
        runId: "bot-run-latest",
        positionId: position.id,
        type: actionType,
        status,
        priority: actionType === "Rebalance" ? "High" : "Medium",
        protocol: "Meteora DLMM",
        title: titleForAction(actionType, position),
        reason: health.reason,
        notionalUsd,
        estimatedFeeUsd: Number((0.0025 + index * 0.001).toFixed(4)),
        simulatedGrossProfitUsd,
        estimatedSlippageBps,
        proposedLowerBin,
        proposedUpperBin,
        simulationStatus: allowedByPolicy ? "Passed" : "Failed",
        executionStatus,
        guardrailResults,
        transactionPlan: {
          steps:
            actionType === "Rebalance"
              ? ["Fetch active bin", "Request Jupiter quote if token ratio is imbalanced", "Build DLMM remove/add liquidity transaction", "Submit only through guard program"]
              : actionType === "ClaimFees"
                ? ["Fetch claimable fees", "Build DLMM claim transaction", "Submit only after wallet or guard approval"]
                : ["Fetch position balances", "Build DLMM close transaction", "Withdraw to owner wallet"],
          requiresWalletSignature: input.policy.requireWalletConfirm,
          requiresDelegatedAuthority: input.policy.executionMode === "DelegatedGuarded",
          guardProgramId: input.policy.guardProgramId,
          onChainPolicyAddress: input.policy.onChainPolicyAddress,
        },
        createdAt: startedAt,
        queuedAt: allowedByPolicy ? startedAt : null,
        executedAt: null,
        resolvedAt: null,
        position,
      } satisfies BotAction;

    return [attachGuardPlan(input.policy, action)];
  });

  const blockedActions = actions.filter((action) => action.status === "Blocked").length;
  const run: BotRun = {
    id: "bot-run-latest",
    userId: input.userId,
    policyId: input.policy.id,
    status: "Completed",
    mode: readiness.canExecuteAutonomously ? "LiveGuarded" : "DryRun",
    startedAt,
    finishedAt: "2026-05-22T09:00:02.000Z",
    positionsScanned: openPositions.length,
    actionsPlanned: actions.length,
    actionsBlocked: blockedActions,
    metadata: {
      worker: "rangeguard-autonomy",
      executionNote: "No transactions were submitted without a configured guard program and delegated authority.",
    },
  };

  return {
    policy: input.policy,
    stats: {
      openPositions: openPositions.length,
      deployedTodayUsd: 0,
      totalPositionsOpened: openPositions.length,
      realizedPnlUsd: input.positions.reduce((sum, position) => sum + position.estimatedPnlUsd, 0),
      dailyLimitUsedUsd: actions.reduce((sum, action) => sum + action.notionalUsd, 0),
      dailyLimitUsd: input.policy.dailyNotionalLimitUsd,
      plannedActions: actions.length,
      blockedActions,
    },
    actions,
    runs: [run],
    copyTargets: input.copyTargets,
    protocolReadiness: readiness,
    executionReceipts: [],
    receiptPersistence: {
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      receiptPath: "",
      receiptsFound: 0,
    },
  };
}
