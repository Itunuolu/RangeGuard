import { hashBotPolicy } from "@/lib/autonomy/actionHash";
import { planAutonomyRun } from "@/lib/autonomy/planner";
import { keeperReceiptPath, readKeeperExecutionReceipts } from "@/lib/autonomy/receiptStore";
import { serverConfig } from "@/lib/config";
import { mockBotPolicy, mockCopyTargets, mockPositions } from "@/lib/mock/data";
import type { BotPolicy } from "@/lib/types";

export function userIdFromWallet(walletAddress?: string | null) {
  return walletAddress ? `user-${walletAddress.slice(0, 8)}` : "user-demo";
}

export function getRuntimeBotPolicy(userId: string): BotPolicy {
  const hasAutonomyConfig =
    serverConfig.autonomyExecutionEnabled ||
    Boolean(serverConfig.autonomyGuardProgramId) ||
    Boolean(serverConfig.autonomyPolicyAddress) ||
    Boolean(serverConfig.autonomyKeeperAuthority) ||
    Boolean(serverConfig.autonomyKeeperSignerUrl);

  const policy: BotPolicy = {
    ...mockBotPolicy,
    userId,
    status: serverConfig.autonomyExecutionEnabled ? "Armed" : mockBotPolicy.status,
    executionMode: hasAutonomyConfig ? "DelegatedGuarded" : mockBotPolicy.executionMode,
    requireWalletConfirm: !serverConfig.autonomyExecutionEnabled,
    guardProgramId: serverConfig.autonomyGuardProgramId || mockBotPolicy.guardProgramId,
    onChainPolicyAddress: serverConfig.autonomyPolicyAddress || mockBotPolicy.onChainPolicyAddress,
    delegatedAuthority: serverConfig.autonomyKeeperAuthority || mockBotPolicy.delegatedAuthority,
    riskAuthority: serverConfig.autonomyRiskAuthority || mockBotPolicy.riskAuthority,
    policyHash: null,
  };

  return {
    ...policy,
    policyHash: hashBotPolicy(policy),
  };
}

export function getBotControlPlane(walletAddress?: string | null) {
  const userId = userIdFromWallet(walletAddress);
  const executionReceipts = readKeeperExecutionReceipts(10);
  const controlPlane = planAutonomyRun({
    userId,
    policy: getRuntimeBotPolicy(userId),
    positions: mockPositions.map((position) => ({ ...position, userId })),
    copyTargets: mockCopyTargets,
  });

  return {
    ...controlPlane,
    executionReceipts,
    receiptPersistence: {
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      receiptPath: keeperReceiptPath(),
      receiptsFound: executionReceipts.length,
    },
  };
}

export function findBotAction(actionId: string, walletAddress?: string | null) {
  const controlPlane = getBotControlPlane(walletAddress);
  const action = controlPlane.actions.find((candidate) => candidate.id === actionId);

  return { controlPlane, action };
}
