import { attachGuardPlan } from "@/lib/autonomy/guardProgram";
import { buildMeteoraDlmmTargetInstructions } from "@/lib/autonomy/meteoraTransactionBuilder";
import { getProtocolReadiness } from "@/lib/autonomy/policy";
import { serverConfig } from "@/lib/config";
import type { BotAction, BotPolicy } from "@/lib/types";

export type AutonomyExecutionPreview = {
  actionId: string;
  canSubmit: boolean;
  status:
    | "Blocked"
    | "WalletRequired"
    | "DelegationRequired"
    | "KeeperSignerRequired"
    | "InstructionBuilderMissing"
    | "Ready";
  reasons: string[];
  transactionPlan: BotAction["transactionPlan"];
};

export type AutonomyExecutionSubmission = {
  actionId: string;
  submitted: boolean;
  status: AutonomyExecutionPreview["status"] | "Submitted" | "AcceptedDryRun" | "Simulated" | "Failed";
  reasons: string[];
  keeperResponse?: unknown;
};

type KeeperSignerResponse = {
  dryRun?: boolean;
  submitted?: boolean;
  status?: string;
  detail?: string;
};

function targetInstructionBuilderSummary(
  buildResult: Awaited<ReturnType<typeof buildMeteoraDlmmTargetInstructions>>,
) {
  return {
    source: buildResult.source,
    status: buildResult.status,
    detail: buildResult.detail,
    instructionCount: buildResult.instructionCount,
    transactionCount: buildResult.transactionCount,
    requiredSigners: buildResult.requiredSigners,
    targetProgramIds: buildResult.targetProgramIds,
  };
}

export function previewAutonomyExecution(policy: BotPolicy, action: BotAction): AutonomyExecutionPreview {
  const readiness = getProtocolReadiness(policy);
  const failedGuardrails = action.guardrailResults.filter((result) => !result.passed);
  const allowedPrograms = new Set(action.transactionPlan.allowedProgramIds || []);
  const disallowedTargets = (action.transactionPlan.targetProgramIds || []).filter(
    (programId) => !allowedPrograms.has(programId),
  );

  if (failedGuardrails.length > 0) {
    return {
      actionId: action.id,
      canSubmit: false,
      status: "Blocked",
      reasons: failedGuardrails.map((result) => `${result.label}: ${result.detail}`),
      transactionPlan: action.transactionPlan,
    };
  }

  if (action.transactionPlan.targetInstructionBuilder?.status === "NeedsWalletSignature") {
    return {
      actionId: action.id,
      canSubmit: false,
      status: "WalletRequired",
      reasons: [action.transactionPlan.targetInstructionBuilder.detail],
      transactionPlan: action.transactionPlan,
    };
  }

  if (
    action.transactionPlan.targetInstructionBuilder?.status === "Failed" ||
    action.transactionPlan.targetInstructionBuilder?.status === "Unsupported"
  ) {
    return {
      actionId: action.id,
      canSubmit: false,
      status: "InstructionBuilderMissing",
      reasons: [action.transactionPlan.targetInstructionBuilder.detail],
      transactionPlan: action.transactionPlan,
    };
  }

  if (
    action.transactionPlan.targetInstructionBuilder?.status === "Built" &&
    (!action.transactionPlan.targetInstructions?.length || !action.transactionPlan.targetInstructionDigest)
  ) {
    return {
      actionId: action.id,
      canSubmit: false,
      status: "InstructionBuilderMissing",
      reasons: ["The Meteora builder reported target instructions, but the signed payload is missing them."],
      transactionPlan: action.transactionPlan,
    };
  }

  if (policy.requireWalletConfirm) {
    return {
      actionId: action.id,
      canSubmit: false,
      status: "WalletRequired",
      reasons: ["Policy requires a connected wallet signature before execution."],
      transactionPlan: action.transactionPlan,
    };
  }

  if (disallowedTargets.length > 0) {
    return {
      actionId: action.id,
      canSubmit: false,
      status: "Blocked",
      reasons: [`Target program(s) are not allowlisted by the runtime config: ${disallowedTargets.join(", ")}.`],
      transactionPlan: action.transactionPlan,
    };
  }

  if (!readiness.canExecuteAutonomously) {
    return {
      actionId: action.id,
      canSubmit: false,
      status: readiness.remoteSignerConfigured ? "DelegationRequired" : "KeeperSignerRequired",
      reasons: readiness.blockers,
      transactionPlan: action.transactionPlan,
    };
  }

  if (!action.transactionPlan.guardInstructionBase64 || !action.transactionPlan.actionHash) {
    return {
      actionId: action.id,
      canSubmit: false,
      status: "InstructionBuilderMissing",
      reasons: ["Guard instruction data or action hash is missing. Refusing to submit an unbound autonomy action."],
      transactionPlan: action.transactionPlan,
    };
  }

  return {
    actionId: action.id,
    canSubmit: true,
    status: "Ready",
    reasons: ["Guardrails passed and protocol execution prerequisites are configured."],
    transactionPlan: action.transactionPlan,
  };
}

export async function submitGuardedAutonomyAction(
  policy: BotPolicy,
  action: BotAction,
  options: { walletAddress?: string | null } = {},
): Promise<AutonomyExecutionSubmission> {
  const targetBuild = await buildMeteoraDlmmTargetInstructions({
    policy,
    action,
    ownerAddress: options.walletAddress,
  });
  let actionForSubmit: BotAction = {
    ...action,
    transactionPlan: {
      ...action.transactionPlan,
      targetInstructionBuilder: targetInstructionBuilderSummary(targetBuild),
    },
  };

  if (targetBuild.status === "Built") {
    actionForSubmit = attachGuardPlan(policy, {
      ...actionForSubmit,
      transactionPlan: {
        ...actionForSubmit.transactionPlan,
        targetInstructions: targetBuild.targetInstructions,
        targetInstructionDigest: targetBuild.targetInstructionDigest,
        targetProgramIds: targetBuild.targetProgramIds,
      },
    });
  }

  const preview = previewAutonomyExecution(policy, actionForSubmit);

  if (!preview.canSubmit) {
    return {
      actionId: actionForSubmit.id,
      submitted: false,
      status: preview.status,
      reasons: preview.reasons,
    };
  }

  if (!serverConfig.autonomyKeeperSignerUrl) {
    return {
      actionId: actionForSubmit.id,
      submitted: false,
      status: "KeeperSignerRequired",
      reasons: ["AUTONOMY_KEEPER_SIGNER_URL is required because the backend must not hold private keys."],
    };
  }

  let response: Response;

  try {
    response = await fetch(serverConfig.autonomyKeeperSignerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "rangeguard-autonomy",
        policy: {
          id: policy.id,
          policyHash: policy.policyHash,
          onChainPolicyAddress: policy.onChainPolicyAddress,
          guardProgramId: policy.guardProgramId,
          delegatedAuthority: policy.delegatedAuthority,
          riskAuthority: policy.riskAuthority,
        },
        action: {
          id: actionForSubmit.id,
          type: actionForSubmit.type,
          actionHash: actionForSubmit.transactionPlan.actionHash,
          targetInstructionDigest: actionForSubmit.transactionPlan.targetInstructionDigest,
          notionalUsd: actionForSubmit.notionalUsd,
          estimatedSlippageBps: actionForSubmit.estimatedSlippageBps,
          proposedLowerBin: actionForSubmit.proposedLowerBin,
          proposedUpperBin: actionForSubmit.proposedUpperBin,
        },
        guardInstruction: {
          dataBase64: actionForSubmit.transactionPlan.guardInstructionBase64,
          accounts: actionForSubmit.transactionPlan.guardAccounts,
        },
        targetProgramIds: actionForSubmit.transactionPlan.targetProgramIds,
        targetInstructions: actionForSubmit.transactionPlan.targetInstructions,
        targetInstructionBuilder: actionForSubmit.transactionPlan.targetInstructionBuilder,
        transactionSteps: actionForSubmit.transactionPlan.steps,
      }),
    });
  } catch (error) {
    return {
      actionId: actionForSubmit.id,
      submitted: false,
      status: "Failed",
      reasons: [
        error instanceof Error
          ? `Keeper signer request failed: ${error.message}`
          : "Keeper signer request failed.",
      ],
    };
  }

  const keeperResponse = (await response.json().catch(() => null)) as KeeperSignerResponse | null;

  if (!response.ok) {
    return {
      actionId: actionForSubmit.id,
      submitted: false,
      status: "Failed",
      reasons: [`Keeper signer rejected submission with HTTP ${response.status}.`],
      keeperResponse,
    };
  }

  if (keeperResponse?.dryRun && !keeperResponse.submitted) {
    const status = keeperResponse.status === "Simulated" ? "Simulated" : "AcceptedDryRun";

    return {
      actionId: actionForSubmit.id,
      submitted: false,
      status,
      reasons: [
        keeperResponse.detail ||
          "Keeper verified the guarded payload in dry-run mode. No transaction was broadcast.",
      ],
      keeperResponse,
    };
  }

  return {
    actionId: actionForSubmit.id,
    submitted: Boolean(keeperResponse?.submitted),
    status: "Submitted",
    reasons: ["Guarded action submitted to the configured remote keeper signer."],
    keeperResponse,
  };
}
