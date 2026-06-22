import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { getPrismaClient } from "@/lib/db";
import type { KeeperExecutionReceipt, Position, PositionEvent } from "@/lib/types";

const DEVNET_USER_WALLET = "rangeguard-devnet-keeper";
const DEFAULT_RECEIPT_PATH = ".rangeguard/devnet/keeper-executions.jsonl";

export function keeperReceiptPath() {
  const configuredPath = process.env.RANGEGUARD_KEEPER_RECEIPT_PATH;

  if (configuredPath) {
    return isAbsolute(configuredPath) ? configuredPath : resolve(/*turbopackIgnore: true*/ configuredPath);
  }

  return DEFAULT_RECEIPT_PATH;
}

function stableId(prefix: string, ...parts: Array<string | number | null | undefined>) {
  return `${prefix}-${createHash("sha256")
    .update(parts.map((part) => String(part ?? "null")).join(":"))
    .digest("hex")
    .slice(0, 24)}`;
}

function receiptTime(receipt: KeeperExecutionReceipt) {
  return receipt.completedAt || receipt.persistedAt || receipt.startedAt;
}

function positionId(address: string | null | undefined) {
  return stableId("position", address);
}

function poolId(address: string | null | undefined) {
  return stableId("pool", address);
}

function eventId(receipt: KeeperExecutionReceipt, eventType: string, signature?: string | null) {
  return stableId("event", receipt.actionId, eventType, signature || receipt.status, receipt.completedAt);
}

function botActionId(receipt: KeeperExecutionReceipt) {
  return receipt.actionId || stableId("bot-action", receipt.oldPositionAddress, receipt.newPositionAddress, receipt.startedAt);
}

export function phaseSignature(receipt: KeeperExecutionReceipt, phaseId: string) {
  return receipt.phaseResults?.find((phase) => phase.phaseId === phaseId)?.signature || null;
}

export function phaseSubmitted(receipt: KeeperExecutionReceipt, phaseId: string) {
  return Boolean(
    receipt.phaseResults?.some((phase) => phase.phaseId === phaseId && phase.status === "Submitted" && phase.signature),
  );
}

function recoveryResolutionKey(actionId: string | null | undefined, startedAt: string | null | undefined) {
  if (!actionId || !startedAt) return null;
  return `${actionId}:${startedAt}`;
}

function recoveryResolutionFromReceipt(receipt: KeeperExecutionReceipt) {
  if (receipt.status !== "Executed" || !receipt.recoverySource) return null;

  const retrySignature = phaseSignature(receipt, "retry-add-liquidity");
  const withdrawSignature = phaseSignature(receipt, "withdraw-to-owner");
  const signature = retrySignature || withdrawSignature;

  if (!signature) return null;
  const mode: NonNullable<KeeperExecutionReceipt["recoveryResolution"]>["mode"] = retrySignature
    ? "RetryAddLiquidity"
    : "WithdrawToOwner";

  return {
    key: recoveryResolutionKey(receipt.recoverySource.actionId, receipt.recoverySource.startedAt),
    resolution: {
      actionId: receipt.actionId,
      completedAt: receipt.completedAt,
      mode,
      signature,
      newPositionAddress: receipt.newPositionAddress ?? null,
    },
  };
}

function annotateRecoveryResolutions(receipts: KeeperExecutionReceipt[]): KeeperExecutionReceipt[] {
  const resolutions = new Map<
    string,
    NonNullable<KeeperExecutionReceipt["recoveryResolution"]>
  >();

  for (const receipt of receipts) {
    const recoveryResolution = recoveryResolutionFromReceipt(receipt);
    if (recoveryResolution?.key) resolutions.set(recoveryResolution.key, recoveryResolution.resolution);
  }

  return receipts.map((receipt) => {
    const key = recoveryResolutionKey(receipt.actionId, receipt.startedAt);
    const recoveryResolution = key ? resolutions.get(key) : null;

    if (!recoveryResolution || !receiptNeedsRecovery(receipt)) return receipt;

    const resolvedReceipt: KeeperExecutionReceipt = {
      ...receipt,
      status: "Recovered",
      recoveryResolution,
      recovery: receipt.recovery
        ? {
            ...receipt.recovery,
            required: false,
            state: "Resolved" as const,
            reason: `Recovery resolved by ${recoveryResolution.mode} receipt ${recoveryResolution.actionId}.`,
          }
        : receipt.recovery,
    };

    return resolvedReceipt;
  });
}

export function receiptNeedsRecovery(receipt: KeeperExecutionReceipt) {
  if (receipt.recoveryResolution || receipt.recovery?.state === "Resolved") return false;
  if (receipt.status === "RecoveryRequired") return true;

  return (
    phaseSubmitted(receipt, "remove-old-position") &&
    !phaseSubmitted(receipt, "add-new-position") &&
    !phaseSubmitted(receipt, "retry-add-liquidity")
  );
}

export function receiptEffectiveStatus(receipt: KeeperExecutionReceipt) {
  if (receipt.recoveryResolution || receipt.recovery?.state === "Resolved") return "Recovered";
  return receiptNeedsRecovery(receipt) ? "RecoveryRequired" : receipt.status;
}

function oldPositionClosed(receipt: KeeperExecutionReceipt) {
  return receipt.status === "Executed" || receiptNeedsRecovery(receipt) || phaseSubmitted(receipt, "remove-old-position");
}

function newPositionPhaseSubmitted(receipt: KeeperExecutionReceipt) {
  return phaseSubmitted(receipt, "add-new-position") || phaseSubmitted(receipt, "retry-add-liquidity");
}

function receiptPool(receipt: KeeperExecutionReceipt): Position["pool"] {
  return {
    id: poolId(receipt.poolAddress),
    poolAddress: receipt.poolAddress || "unknown-devnet-pool",
    tokenASymbol: "DLMM-A",
    tokenBSymbol: "DLMM-B",
    protocol: "Meteora DLMM",
    riskLabel: "Low",
    riskScore: 20,
    liquidityUsd: 0,
    poolType: "Any",
  };
}

function safeDate(value: string | null | undefined) {
  const parsed = value ? new Date(value) : new Date();

  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function readJsonLine(line: string) {
  try {
    return JSON.parse(line) as KeeperExecutionReceipt;
  } catch {
    return null;
  }
}

export function readKeeperExecutionReceipts(limit = 25) {
  const path = keeperReceiptPath();

  if (!existsSync(path)) return [];

  const receipts = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(readJsonLine)
    .filter((receipt): receipt is KeeperExecutionReceipt => Boolean(receipt))
    .sort((a, b) => new Date(receiptTime(b)).getTime() - new Date(receiptTime(a)).getTime());

  return annotateRecoveryResolutions(receipts).slice(0, limit);
}

export function receiptToEvents(receipt: KeeperExecutionReceipt): PositionEvent[] {
  const createdAt = receiptTime(receipt);
  const removeSignature = phaseSignature(receipt, "remove-old-position");
  const addSignature = phaseSignature(receipt, "add-new-position") || phaseSignature(receipt, "retry-add-liquidity");
  const withdrawSignature = phaseSignature(receipt, "withdraw-to-owner");
  const effectiveStatus = receiptEffectiveStatus(receipt);

  if (effectiveStatus === "RecoveryRequired") {
    return [
      {
        id: eventId(receipt, "Position closed", removeSignature),
        positionId: positionId(receipt.oldPositionAddress),
        eventType: "Position closed",
        txSignature: removeSignature,
        message: `Guarded keeper closed old DLMM position ${receipt.oldPositionAddress}.`,
        metadata: {
          source: "keeper",
          phaseId: "remove-old-position",
          poolAddress: receipt.poolAddress,
          recoveryRequired: true,
        },
        createdAt,
      },
      {
        id: eventId(receipt, "Error"),
        positionId: positionId(receipt.oldPositionAddress),
        eventType: "Error",
        txSignature: null,
        message:
          receipt.error ||
          "Recovery required: phase 1 was submitted, but the add-liquidity phase did not complete.",
        metadata: { source: "keeper", receipt, recoveryRequired: true },
        createdAt,
      },
    ];
  }

  if (effectiveStatus === "Recovered") {
    return [
      {
        id: eventId(receipt, "Position closed", removeSignature),
        positionId: positionId(receipt.oldPositionAddress),
        eventType: "Position closed",
        txSignature: removeSignature,
        message: `Guarded keeper closed old DLMM position ${receipt.oldPositionAddress}; recovery was resolved by ${receipt.recoveryResolution?.mode}.`,
        metadata: {
          source: "keeper",
          phaseId: "remove-old-position",
          poolAddress: receipt.poolAddress,
          recoveryResolved: true,
          recoveryResolution: receipt.recoveryResolution,
        },
        createdAt,
      },
    ];
  }

  if (receipt.status !== "Executed") {
    return [
      {
        id: eventId(receipt, "Error"),
        positionId: positionId(receipt.oldPositionAddress),
        eventType: "Error",
        txSignature: removeSignature || addSignature || withdrawSignature,
        message: receipt.error || `Keeper full rebalance ended with status ${receipt.status}.`,
        metadata: { source: "keeper", receipt },
        createdAt,
      },
    ];
  }

  const events: PositionEvent[] = [];

  if (removeSignature) {
    events.push({
      id: eventId(receipt, "Position closed", removeSignature),
      positionId: positionId(receipt.oldPositionAddress),
      eventType: "Position closed",
      txSignature: removeSignature,
      message: `Guarded keeper closed old DLMM position ${receipt.oldPositionAddress}.`,
      metadata: {
        source: "keeper",
        phaseId: "remove-old-position",
        poolAddress: receipt.poolAddress,
        newPositionAddress: receipt.newPositionAddress,
      },
      createdAt,
    });
  }

  if (receipt.newPositionAddress && addSignature) {
    events.push({
      id: eventId(receipt, "Position created", addSignature),
      positionId: positionId(receipt.newPositionAddress),
      eventType: "Position created",
      txSignature: addSignature,
      message: `Guarded keeper opened new DLMM position ${receipt.newPositionAddress} in bins ${receipt.postflight?.lowerBin ?? receipt.expectedNewLowerBin} to ${receipt.postflight?.upperBin ?? receipt.expectedNewUpperBin}.`,
      metadata: {
        source: "keeper",
        phaseId: phaseSignature(receipt, "retry-add-liquidity") ? "retry-add-liquidity" : "add-new-position",
        poolAddress: receipt.poolAddress,
        oldPositionAddress: receipt.oldPositionAddress,
        activeBin: receipt.postflight?.activeBin,
        postflight: receipt.postflight,
        recovery: receipt.recovery,
      },
      createdAt,
    });
  }

  if (withdrawSignature) {
    events.push({
      id: eventId(receipt, "Position closed", withdrawSignature),
      positionId: positionId(receipt.oldPositionAddress),
      eventType: "Position closed",
      txSignature: withdrawSignature,
      message: "Guarded keeper withdrew keeper-held token balances back to the owner wallet.",
      metadata: {
        source: "keeper",
        phaseId: "withdraw-to-owner",
        poolAddress: receipt.poolAddress,
        recovery: receipt.recovery,
      },
      createdAt,
    });
  }

  return events.length > 0
    ? events
    : [
        {
          id: eventId(receipt, "Position scanned"),
          positionId: positionId(receipt.oldPositionAddress || receipt.newPositionAddress),
          eventType: "Position scanned",
          txSignature: null,
          message: `Keeper receipt ${receipt.actionId || receipt.requestType} was recorded.`,
          metadata: { source: "keeper", receipt },
          createdAt,
        },
      ];
}

export function receiptToPositions(receipt: KeeperExecutionReceipt): Position[] {
  const openedAt = receipt.completedAt || receipt.startedAt;
  const effectiveStatus = receiptEffectiveStatus(receipt);
  const recoveryRequired = effectiveStatus === "RecoveryRequired";
  const oldClosed = oldPositionClosed(receipt);
  const newPhaseSubmitted = newPositionPhaseSubmitted(receipt);
  const newPositionOpen = receipt.status === "Executed" && newPhaseSubmitted;
  const activeBin = receipt.postflight?.activeBin ?? null;
  const plannedLowerBin = receipt.postflight?.lowerBin ?? receipt.expectedNewLowerBin ?? receipt.proposedLowerBin ?? 0;
  const plannedUpperBin = receipt.postflight?.upperBin ?? receipt.expectedNewUpperBin ?? receipt.proposedUpperBin ?? 0;
  const base = {
    userId: receipt.postflight?.owner || DEVNET_USER_WALLET,
    strategyId: null,
    poolId: poolId(receipt.poolAddress),
    entryValueUsd: receipt.notionalUsd || 0,
    estimatedPnlUsd: 0,
    estimatedPnlPct: 0,
    feesEarnedUsd: 0,
    activeBinAtEntry: activeBin,
    currentActiveBin: activeBin,
    openedAt,
    createdAt: openedAt,
    updatedAt: receipt.completedAt || receipt.persistedAt || openedAt,
    pool: receiptPool(receipt),
    healthTimeline: [],
    feeTimeline: [],
    pnlTimeline: [],
  };
  const positions: Position[] = [];

  if (receipt.oldPositionAddress) {
    positions.push({
      ...base,
      id: positionId(receipt.oldPositionAddress),
      positionAddress: receipt.oldPositionAddress,
      currentValueUsd: oldClosed ? 0 : receipt.notionalUsd || 0,
      lowerBin: receipt.proposedLowerBin ?? receipt.expectedNewLowerBin ?? plannedLowerBin,
      upperBin: receipt.proposedUpperBin ?? receipt.expectedNewUpperBin ?? plannedUpperBin,
      healthStatus: oldClosed ? "Closed" : "Out of range",
      healthScore: oldClosed ? 0 : 35,
      suggestedAction: recoveryRequired ? "Rebalance" : oldClosed ? "Hold" : "Rebalance",
      status: oldClosed ? "Closed" : "Open",
      recoveryStatus: recoveryRequired ? "RecoveryRequired" : null,
      closedAt: oldClosed ? receipt.completedAt || receipt.persistedAt || openedAt : null,
    });
  }

  if (receipt.newPositionAddress && newPhaseSubmitted) {
    positions.push({
      ...base,
      id: positionId(receipt.newPositionAddress),
      positionAddress: receipt.newPositionAddress,
      currentValueUsd: newPositionOpen ? receipt.notionalUsd || 0 : 0,
      lowerBin: plannedLowerBin,
      upperBin: plannedUpperBin,
      healthStatus: newPositionOpen ? "In range" : "Closed",
      healthScore: newPositionOpen ? 92 : 0,
      suggestedAction: "Hold",
      status: newPositionOpen ? "Open" : "Closed",
      recoveryStatus: newPositionOpen && receipt.recovery ? "Resolved" : null,
      closedAt: newPositionOpen ? null : receipt.completedAt || receipt.persistedAt || openedAt,
    });
  }

  return positions;
}

export function receiptPositions(limit = 25) {
  return readKeeperExecutionReceipts(limit).flatMap(receiptToPositions);
}

export async function syncKeeperReceiptToDatabase(receipt: KeeperExecutionReceipt) {
  const prisma = await getPrismaClient();

  if (!prisma || !prisma.pool || !prisma.position || !prisma.positionEvent || !prisma.botPolicy || !prisma.botAction) {
    return { persisted: false, reason: "DATABASE_URL or Prisma models are not available." };
  }

  const ownerWallet = receipt.postflight?.owner || DEVNET_USER_WALLET;
  const user = await prisma.user.upsert({
    where: { walletAddress: ownerWallet },
    update: {},
    create: { walletAddress: ownerWallet },
  });
  const pool = await prisma.pool.upsert({
    where: { poolAddress: receipt.poolAddress || "unknown-devnet-pool" },
    update: {
      activeBin: receipt.postflight?.activeBin ?? null,
      lastScannedAt: safeDate(receipt.completedAt),
    },
    create: {
      id: poolId(receipt.poolAddress),
      poolAddress: receipt.poolAddress || "unknown-devnet-pool",
      protocol: "Meteora DLMM",
      tokenAMint: "devnet-token-a",
      tokenBMint: "devnet-token-b",
      tokenASymbol: "DLMM-A",
      tokenBSymbol: "DLMM-B",
      liquidityUsd: 0,
      volume24hUsd: 0,
      feeApr: 0,
      volatilityScore: 0,
      riskScore: 0,
      riskLabel: "Low",
      riskReasons: ["Devnet keeper execution receipt."],
      activeBin: receipt.postflight?.activeBin ?? null,
      lastScannedAt: safeDate(receipt.completedAt),
    },
  });
  const policyId = receipt.policyId || "devnet-meteora-proof-policy";

  await prisma.botPolicy.upsert({
    where: { id: policyId },
    update: {
      status: "Armed",
      executionMode: "DelegatedGuarded",
      requireWalletConfirm: false,
      updatedAt: safeDate(receipt.completedAt),
    },
    create: {
      id: policyId,
      userId: user.id,
      name: "Devnet Meteora Proof Policy",
      mode: "DelegatedAutonomy",
      status: "Armed",
      executionMode: "DelegatedGuarded",
      maxPositionSizeUsd: receipt.notionalUsd || 0,
      dailyNotionalLimitUsd: receipt.notionalUsd || 0,
      maxSlippageBps: receipt.estimatedSlippageBps || 0,
      maxPoolRiskScore: 100,
      minPoolLiquidityUsd: 0,
      maxOpenPositions: 10,
      dailyRebalanceLimit: 6,
      stopLossPct: 0,
      takeProfitPct: 0,
      allowedPoolTypes: ["Stable", "Blue-chip", "Any"],
      allowedPoolAddresses: receipt.poolAddress ? [receipt.poolAddress] : [],
      requireSimulation: true,
      requireWalletConfirm: false,
      guardProgramId: process.env.AUTONOMY_GUARD_PROGRAM_ID || null,
      onChainPolicyAddress: process.env.AUTONOMY_POLICY_ADDRESS || null,
      delegatedAuthority: receipt.postflight?.owner || process.env.AUTONOMY_KEEPER_AUTHORITY || null,
      riskAuthority: process.env.AUTONOMY_RISK_AUTHORITY || null,
      policyHash: null,
    },
  });

  const openedAt = safeDate(receipt.completedAt || receipt.startedAt);
  const effectiveStatus = receiptEffectiveStatus(receipt);
  const recoveryRequired = effectiveStatus === "RecoveryRequired";
  const oldClosed = oldPositionClosed(receipt);
  const newPhaseSubmitted = newPositionPhaseSubmitted(receipt);
  const newPositionOpen = receipt.status === "Executed" && newPhaseSubmitted;
  const botActionStatus = receipt.status === "Executed" ? "Executed" : "Failed";
  const botActionReason = recoveryRequired
    ? "Phase 1 was submitted, but add-liquidity did not complete. Retry add-liquidity or withdraw-to-owner fallback is required."
    : "Persisted from a guarded keeper live rebalance receipt.";

  if (receipt.oldPositionAddress) {
    await prisma.position.upsert({
      where: { id: positionId(receipt.oldPositionAddress) },
      update: {
        status: oldClosed ? "Closed" : "Open",
        healthStatus: oldClosed ? "Closed" : "Out of range",
        suggestedAction: recoveryRequired ? "Rebalance" : oldClosed ? "Hold" : "Rebalance",
        closedAt: oldClosed ? openedAt : null,
        currentActiveBin: receipt.postflight?.activeBin ?? null,
      },
      create: {
        id: positionId(receipt.oldPositionAddress),
        userId: user.id,
        poolId: pool.id,
        positionAddress: receipt.oldPositionAddress,
        entryValueUsd: receipt.notionalUsd || 0,
        currentValueUsd: 0,
        estimatedPnlUsd: 0,
        estimatedPnlPct: 0,
        feesEarnedUsd: 0,
        lowerBin: receipt.proposedLowerBin ?? receipt.expectedNewLowerBin ?? 0,
        upperBin: receipt.proposedUpperBin ?? receipt.expectedNewUpperBin ?? 0,
        activeBinAtEntry: receipt.postflight?.activeBin ?? null,
        currentActiveBin: receipt.postflight?.activeBin ?? null,
        healthStatus: oldClosed ? "Closed" : "Out of range",
        healthScore: oldClosed ? 0 : 45,
        suggestedAction: recoveryRequired ? "Rebalance" : oldClosed ? "Hold" : "Rebalance",
        status: oldClosed ? "Closed" : "Open",
        openedAt,
        closedAt: oldClosed ? openedAt : null,
      },
    });
  }

  if (receipt.newPositionAddress && newPhaseSubmitted) {
    await prisma.position.upsert({
      where: { id: positionId(receipt.newPositionAddress) },
      update: {
        status: newPositionOpen ? "Open" : "Closed",
        lowerBin: receipt.postflight?.lowerBin ?? receipt.expectedNewLowerBin ?? 0,
        upperBin: receipt.postflight?.upperBin ?? receipt.expectedNewUpperBin ?? 0,
        currentActiveBin: receipt.postflight?.activeBin ?? null,
      },
      create: {
        id: positionId(receipt.newPositionAddress),
        userId: user.id,
        poolId: pool.id,
        positionAddress: receipt.newPositionAddress,
        entryValueUsd: receipt.notionalUsd || 0,
        currentValueUsd: receipt.notionalUsd || 0,
        estimatedPnlUsd: 0,
        estimatedPnlPct: 0,
        feesEarnedUsd: 0,
        lowerBin: receipt.postflight?.lowerBin ?? receipt.expectedNewLowerBin ?? 0,
        upperBin: receipt.postflight?.upperBin ?? receipt.expectedNewUpperBin ?? 0,
        activeBinAtEntry: receipt.postflight?.activeBin ?? null,
        currentActiveBin: receipt.postflight?.activeBin ?? null,
        healthStatus: newPositionOpen ? "In range" : "Closed",
        healthScore: newPositionOpen ? 92 : 0,
        suggestedAction: "Hold",
        status: newPositionOpen ? "Open" : "Closed",
        openedAt,
        closedAt: newPositionOpen ? null : openedAt,
      },
    });
  }

  await prisma.botAction.upsert({
    where: { id: botActionId(receipt) },
    update: {
      status: botActionStatus,
      executionStatus: botActionStatus,
      title: recoveryRequired ? "Keeper rebalance recovery required" : "Keeper full rebalance",
      reason: botActionReason,
      transactionPlan: receipt,
      executedAt: receipt.status === "Executed" ? openedAt : null,
      resolvedAt: openedAt,
    },
    create: {
      id: botActionId(receipt),
      userId: user.id,
      policyId,
      runId: null,
      positionId:
        receipt.newPositionAddress && newPositionOpen
          ? positionId(receipt.newPositionAddress)
          : receipt.oldPositionAddress
            ? positionId(receipt.oldPositionAddress)
            : null,
      type: "Rebalance",
      status: botActionStatus,
      priority: "High",
      protocol: "Meteora DLMM",
      title: recoveryRequired ? "Keeper rebalance recovery required" : "Keeper full rebalance",
      reason: botActionReason,
      notionalUsd: receipt.notionalUsd || 0,
      estimatedFeeUsd: 0,
      estimatedSlippageBps: receipt.estimatedSlippageBps || 0,
      proposedLowerBin: receipt.expectedNewLowerBin ?? null,
      proposedUpperBin: receipt.expectedNewUpperBin ?? null,
      simulationStatus: receipt.status === "Executed" ? "Passed" : "Failed",
      executionStatus: botActionStatus,
      guardrailResults: receipt.postflight?.checks || [],
      transactionPlan: receipt,
      queuedAt: safeDate(receipt.startedAt),
      executedAt: receipt.status === "Executed" ? openedAt : null,
      resolvedAt: openedAt,
    },
  });

  for (const event of receiptToEvents(receipt)) {
    await prisma.positionEvent.upsert({
      where: { id: event.id },
      update: {
        txSignature: event.txSignature,
        message: event.message,
        metadata: event.metadata,
      },
      create: {
        id: event.id,
        positionId: event.positionId,
        eventType: event.eventType,
        txSignature: event.txSignature,
        message: event.message,
        metadata: event.metadata,
        createdAt: safeDate(event.createdAt),
      },
    });
  }

  return { persisted: true, reason: "Receipt synced to Prisma." };
}

export async function persistKeeperExecutionReceipt(receipt: KeeperExecutionReceipt) {
  const path = keeperReceiptPath();
  const persistedReceipt = {
    persistedAt: new Date().toISOString(),
    ...receipt,
  };

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(persistedReceipt)}\n`);

  const database = await syncKeeperReceiptToDatabase(persistedReceipt);

  return {
    receipt: persistedReceipt,
    path,
    database,
  };
}

export function receiptEvents(limit = 25) {
  return readKeeperExecutionReceipts(limit).flatMap(receiptToEvents);
}
