import { getBotControlPlane } from "@/lib/autonomy/runtime";
import { readKeeperExecutionReceipts, receiptNeedsRecovery } from "@/lib/autonomy/receiptStore";
import { serverConfig } from "@/lib/config";
import type { BotPolicy, KeeperExecutionReceipt, KeeperRecoveryMode } from "@/lib/types";

export type RecoveryTokenTransferInput = {
  mint: string;
  amount: string;
  tokenProgramId?: string | null;
};

export type RecoverySubmissionInput = {
  mode: KeeperRecoveryMode;
  actionId?: string | null;
  startedAt?: string | null;
  walletAddress?: string | null;
  ownerAddress?: string | null;
  tokenTransfers?: RecoveryTokenTransferInput[];
};

export type RecoverySubmissionResult = {
  mode: KeeperRecoveryMode;
  receiptActionId: string | null;
  submitted: boolean;
  status: string;
  reasons: string[];
  keeperResponse?: unknown;
};

function isDevnetRuntime() {
  return process.env.SOLANA_CLUSTER === "devnet" || serverConfig.solanaRpcUrl.includes("devnet");
}

function policyPayload(policy: BotPolicy) {
  return {
    id: policy.id,
    policyHash: policy.policyHash,
    onChainPolicyAddress: policy.onChainPolicyAddress,
    guardProgramId: policy.guardProgramId,
    delegatedAuthority: policy.delegatedAuthority,
    riskAuthority: policy.riskAuthority,
  };
}

function findReceipt(input: RecoverySubmissionInput) {
  return readKeeperExecutionReceipts(100).find((receipt) => {
    if (input.actionId !== undefined && receipt.actionId !== input.actionId) return false;
    if (input.startedAt && receipt.startedAt !== input.startedAt) return false;
    return true;
  });
}

function responseStatus(keeperResponse: unknown) {
  if (!keeperResponse || typeof keeperResponse !== "object") return "Failed";
  const status = (keeperResponse as { status?: unknown }).status;
  return typeof status === "string" ? status : "Submitted";
}

function responseReason(keeperResponse: unknown) {
  if (!keeperResponse || typeof keeperResponse !== "object") return null;
  const detail = (keeperResponse as { detail?: unknown }).detail;
  const error = (keeperResponse as { error?: unknown }).error;
  if (typeof detail === "string") return detail;
  if (typeof error === "string") return error;
  return null;
}

function submittedFlag(keeperResponse: unknown) {
  if (!keeperResponse || typeof keeperResponse !== "object") return false;
  return Boolean((keeperResponse as { submitted?: unknown }).submitted);
}

function tokenTransfersForRecovery(receipt: KeeperExecutionReceipt, input: RecoverySubmissionInput) {
  if (input.tokenTransfers && input.tokenTransfers.length > 0) return input.tokenTransfers;

  return (receipt.tokenMetadata?.transfers || []).map((transfer) => ({
    mint: transfer.mint,
    amount: transfer.amount,
    tokenProgramId: transfer.tokenProgramId ?? null,
  }));
}

function dryRunFlag(keeperResponse: unknown) {
  if (!keeperResponse || typeof keeperResponse !== "object") return false;
  return Boolean((keeperResponse as { dryRun?: unknown }).dryRun);
}

export async function submitRecoveryToKeeper(input: RecoverySubmissionInput): Promise<RecoverySubmissionResult> {
  if (serverConfig.mockMode) {
    return {
      mode: input.mode,
      receiptActionId: input.actionId ?? null,
      submitted: false,
      status: "Blocked",
      reasons: ["Recovery execution is devnet-only. Set MOCK_MODE=false before submitting recovery actions."],
    };
  }

  if (!isDevnetRuntime()) {
    return {
      mode: input.mode,
      receiptActionId: input.actionId ?? null,
      submitted: false,
      status: "Blocked",
      reasons: ["Recovery execution is devnet-only. Use a devnet RPC or SOLANA_CLUSTER=devnet."],
    };
  }

  if (!serverConfig.autonomyKeeperSignerUrl) {
    return {
      mode: input.mode,
      receiptActionId: input.actionId ?? null,
      submitted: false,
      status: "KeeperSignerRequired",
      reasons: ["AUTONOMY_KEEPER_SIGNER_URL is required for guarded recovery execution."],
    };
  }

  const receipt = findReceipt(input);
  if (!receipt) {
    return {
      mode: input.mode,
      receiptActionId: input.actionId ?? null,
      submitted: false,
      status: "NotFound",
      reasons: ["Recovery receipt was not found in the local keeper receipt store."],
    };
  }

  if (!receiptNeedsRecovery(receipt)) {
    return {
      mode: input.mode,
      receiptActionId: receipt.actionId,
      submitted: false,
      status: "Blocked",
      reasons: ["This receipt is not in RecoveryRequired state."],
    };
  }

  const controlPlane = getBotControlPlane(input.walletAddress);
  const policy = controlPlane.policy;
  const tokenTransfers = tokenTransfersForRecovery(receipt, input);

  if (input.mode === "WithdrawToOwner" && tokenTransfers.length === 0) {
    return {
      mode: input.mode,
      receiptActionId: receipt.actionId,
      submitted: false,
      status: "Blocked",
      reasons: ["Withdraw-to-owner requires token mint and amount details in the receipt or request body."],
    };
  }

  try {
    const response = await fetch(serverConfig.autonomyKeeperSignerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "rangeguard-autonomy",
        requestType: "MeteoraRebalanceRecovery",
        policy: policyPayload(policy),
        recovery: {
          mode: input.mode,
          receipt,
          ownerAddress: input.ownerAddress,
          tokenTransfers,
        },
      }),
    });
    const keeperResponse = (await response.json().catch(() => null)) as unknown;
    const accepted = response.ok || dryRunFlag(keeperResponse);

    return {
      mode: input.mode,
      receiptActionId: receipt.actionId,
      submitted: submittedFlag(keeperResponse),
      status: accepted ? responseStatus(keeperResponse) : "Failed",
      reasons: [
        responseReason(keeperResponse) ||
          (accepted
            ? "Keeper accepted the guarded recovery request."
            : `Keeper rejected the guarded recovery request with HTTP ${response.status}.`),
      ],
      keeperResponse,
    };
  } catch (error) {
    return {
      mode: input.mode,
      receiptActionId: receipt.actionId,
      submitted: false,
      status: "Failed",
      reasons: [
        error instanceof Error ? `Keeper signer request failed: ${error.message}` : "Keeper signer request failed.",
      ],
    };
  }
}
