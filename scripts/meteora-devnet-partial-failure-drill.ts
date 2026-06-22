import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import DLMM from "@meteora-ag/dlmm";
import { Connection, PublicKey } from "@solana/web3.js";

import { readKeeperExecutionReceipts, receiptNeedsRecovery, syncKeeperReceiptToDatabase } from "@/lib/autonomy/receiptStore";
import type { BotAction, BotPolicy, KeeperExecutionReceipt, Position } from "@/lib/types";

const DEFAULT_RPC = "https://api.devnet.solana.com";
const PROOF_PATH = ".rangeguard/devnet/meteora-proof.json";
const DRILL_PROOF_PATH = ".rangeguard/devnet/partial-failure-drill.json";

type KeeperHealth = {
  ok?: boolean;
  dryRun?: boolean;
  partialFailureDrillEnabled?: boolean;
  keeper?: string | null;
  riskAuthority?: string | null;
  detail?: string;
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requireDrillEnv() {
  if (process.env.RANGEGUARD_PARTIAL_FAILURE_DRILL !== "true") {
    throw new Error("Set RANGEGUARD_PARTIAL_FAILURE_DRILL=true to intentionally create a devnet partial failure.");
  }

  if (process.env.AUTONOMY_DEVNET_LIVE_REBALANCE !== "true") {
    throw new Error("Set AUTONOMY_DEVNET_LIVE_REBALANCE=true before running the live devnet drill.");
  }

  if (process.env.SOLANA_CLUSTER !== "devnet" && !(process.env.SOLANA_RPC_URL || DEFAULT_RPC).includes("devnet")) {
    throw new Error("The partial-failure drill is devnet-only.");
  }
}

function readJsonFile(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function proofPositionAddress(proof: Record<string, unknown> | null) {
  const live = proof?.liveFullRebalanceSubmit as { response?: { newPositionAddress?: unknown; postflight?: { newPositionAddress?: unknown } } } | undefined;

  return (
    stringValue(process.env.METEORA_PARTIAL_FAILURE_POSITION) ||
    stringValue(live?.response?.postflight?.newPositionAddress) ||
    stringValue(live?.response?.newPositionAddress) ||
    stringValue(proof?.currentPositionAddress) ||
    stringValue(proof?.positionAddress)
  );
}

function proofPoolAddress(proof: Record<string, unknown> | null) {
  return stringValue(process.env.METEORA_PARTIAL_FAILURE_POOL) || stringValue(proof?.poolAddress);
}

function latestExecutedReceiptPosition() {
  return readKeeperExecutionReceipts(25).find(
    (receipt) => receipt.status === "Executed" && receipt.newPositionAddress && receipt.poolAddress,
  );
}

function assertNoOpenRecovery() {
  const recoveryReceipt = readKeeperExecutionReceipts(25).find(receiptNeedsRecovery);
  if (!recoveryReceipt) return;

  throw new Error(
    `A RecoveryRequired receipt already exists (${recoveryReceipt.actionId || recoveryReceipt.startedAt}). Resolve it before creating another partial-failure drill.`,
  );
}

async function keeperHealth() {
  const url = new URL(required("AUTONOMY_KEEPER_SIGNER_URL"));
  url.searchParams.set("health", "1");
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
  const body = (await response.json().catch(() => null)) as KeeperHealth | null;

  if (!response.ok || !body?.ok) {
    throw new Error(`Keeper health check failed: ${body?.detail || `HTTP ${response.status}`}`);
  }

  if (body.dryRun) {
    throw new Error("Keeper is in dry-run mode. Restart it with RANGEGUARD_KEEPER_DRY_RUN=false for this drill.");
  }

  if (!body.partialFailureDrillEnabled) {
    throw new Error("Keeper is not armed for the drill. Restart it with RANGEGUARD_PARTIAL_FAILURE_DRILL=true.");
  }

  return body;
}

function basePolicy(): BotPolicy {
  const now = new Date().toISOString();

  return {
    id: "devnet-partial-failure-policy",
    userId: "devnet-partial-failure",
    name: "Devnet Partial Failure Drill Policy",
    mode: "DelegatedAutonomy",
    status: "Armed",
    executionMode: "DelegatedGuarded",
    maxPositionSizeUsd: 2_500,
    dailyNotionalLimitUsd: 5_000,
    maxSlippageBps: 50,
    maxPoolRiskScore: 60,
    minPoolLiquidityUsd: 0,
    maxOpenPositions: 10,
    dailyRebalanceLimit: 6,
    stopLossPct: 8,
    takeProfitPct: 25,
    allowedPoolTypes: ["Stable", "Blue-chip", "Any"],
    allowedPoolAddresses: [],
    requireSimulation: true,
    requireWalletConfirm: false,
    guardProgramId: required("AUTONOMY_GUARD_PROGRAM_ID"),
    onChainPolicyAddress: required("AUTONOMY_POLICY_ADDRESS"),
    delegatedAuthority: required("AUTONOMY_KEEPER_AUTHORITY"),
    riskAuthority: required("AUTONOMY_RISK_AUTHORITY"),
    policyHash: null,
    createdAt: now,
    updatedAt: now,
  };
}

function rangeGuardPosition({
  poolAddress,
  positionAddress,
  lowerBin,
  upperBin,
  activeBin,
}: {
  poolAddress: string;
  positionAddress: string;
  lowerBin: number;
  upperBin: number;
  activeBin: number;
}): Position {
  const now = new Date().toISOString();

  return {
    id: "devnet-partial-failure-position",
    userId: "devnet-partial-failure",
    strategyId: null,
    poolId: "devnet-partial-failure-pool",
    positionAddress,
    entryValueUsd: 2,
    currentValueUsd: 2,
    estimatedPnlUsd: 0,
    estimatedPnlPct: 0,
    feesEarnedUsd: 0,
    lowerBin,
    upperBin,
    activeBinAtEntry: activeBin,
    currentActiveBin: activeBin,
    healthStatus: "In range",
    healthScore: 92,
    suggestedAction: "Rebalance",
    status: "Open",
    openedAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    pool: {
      id: "devnet-partial-failure-pool",
      poolAddress,
      tokenASymbol: "RGX",
      tokenBSymbol: "RGY",
      protocol: "Meteora DLMM",
      riskLabel: "Low",
      riskScore: 20,
      liquidityUsd: 2,
      poolType: "Stable",
    },
    healthTimeline: [],
    feeTimeline: [],
    pnlTimeline: [],
  };
}

function drillAction(position: Position): BotAction {
  const now = new Date().toISOString();
  const activeBin = position.currentActiveBin ?? 0;
  const suffix = now.replace(/[:.]/g, "-");

  return {
    id: `devnet-partial-failure-drill-${suffix}`,
    userId: "devnet-partial-failure",
    policyId: "devnet-partial-failure-policy",
    runId: "devnet-partial-failure-run",
    positionId: position.id,
    type: "Rebalance",
    status: "Queued",
    priority: "High",
    protocol: "Meteora DLMM",
    title: "Forced partial rebalance drill for RGX/RGY",
    reason: "Intentionally submits phase 1 and skips phase 2 on devnet to verify recovery-state handling.",
    notionalUsd: 2,
    estimatedFeeUsd: 0.002,
    estimatedSlippageBps: 25,
    proposedLowerBin: activeBin - 8,
    proposedUpperBin: activeBin + 8,
    simulationStatus: "Passed",
    executionStatus: "Ready",
    guardrailResults: [
      {
        id: "devnet-partial-failure",
        label: "Devnet partial-failure drill",
        passed: true,
        detail: "Explicitly enabled devnet drill; never allowed on mainnet.",
      },
    ],
    transactionPlan: {
      steps: [
        "Keeper generates a replacement Meteora position signer internally",
        "Keeper broadcasts remove/claim/close for the old position",
        "Keeper intentionally skips add-liquidity",
        "Keeper persists a RecoveryRequired receipt",
      ],
      requiresWalletSignature: false,
      requiresDelegatedAuthority: true,
      guardProgramId: required("AUTONOMY_GUARD_PROGRAM_ID"),
      onChainPolicyAddress: required("AUTONOMY_POLICY_ADDRESS"),
    },
    createdAt: now,
    queuedAt: now,
    executedAt: null,
    resolvedAt: null,
    position,
  };
}

async function submitPartialFailureDrill(policy: BotPolicy, action: BotAction) {
  const response = await fetch(required("AUTONOMY_KEEPER_SIGNER_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "rangeguard-autonomy",
      requestType: "MeteoraFullRebalance",
      policy,
      action: {
        id: action.id,
        type: action.type,
        notionalUsd: action.notionalUsd,
        estimatedSlippageBps: action.estimatedSlippageBps,
        proposedLowerBin: action.proposedLowerBin,
        proposedUpperBin: action.proposedUpperBin,
      },
      fullRebalance: {
        action,
        drill: {
          forcePhase2Failure: true,
          label: "devnet-partial-failure",
        },
      },
      transactionSteps: action.transactionPlan.steps,
    }),
  });
  const body = (await response.json().catch(() => null)) as KeeperExecutionReceipt & {
    ok?: boolean;
    receiptPath?: string;
    databasePersistence?: unknown;
  };

  if (body?.status !== "RecoveryRequired") {
    throw new Error(`Expected RecoveryRequired receipt, got ${body?.status || `HTTP ${response.status}`}.`);
  }

  if (!body.phaseResults?.some((phase) => phase.phaseId === "remove-old-position" && phase.status === "Submitted")) {
    throw new Error("Drill did not submit phase 1.");
  }

  if (body.phaseResults?.some((phase) => phase.phaseId === "add-new-position" && phase.status === "Submitted")) {
    throw new Error("Drill unexpectedly submitted phase 2.");
  }

  return body;
}

async function main() {
  process.env.MOCK_MODE = "false";
  process.env.NEXT_PUBLIC_MOCK_MODE = "false";

  requireDrillEnv();
  assertNoOpenRecovery();
  const health = await keeperHealth();
  const proof = readJsonFile(PROOF_PATH);
  const latestExecuted = latestExecutedReceiptPosition();
  const poolAddress = stringValue(process.env.METEORA_PARTIAL_FAILURE_POOL) || latestExecuted?.poolAddress || proofPoolAddress(proof);
  const positionAddress =
    stringValue(process.env.METEORA_PARTIAL_FAILURE_POSITION) ||
    latestExecuted?.newPositionAddress ||
    proofPositionAddress(proof);

  if (!poolAddress || !positionAddress) {
    throw new Error("Could not resolve a devnet DLMM pool and keeper-owned position for the drill.");
  }

  const connection = new Connection(process.env.SOLANA_RPC_URL || DEFAULT_RPC, "confirmed");
  const dlmmPool = await DLMM.create(connection, new PublicKey(poolAddress), { cluster: "devnet" });
  const lbPosition = await dlmmPool.getPosition(new PublicKey(positionAddress));
  const owner = lbPosition.positionData.owner.toBase58();

  if (owner !== required("AUTONOMY_KEEPER_AUTHORITY")) {
    throw new Error(`Resolved position owner is ${owner}, not the configured keeper authority.`);
  }

  const position = rangeGuardPosition({
    poolAddress,
    positionAddress,
    lowerBin: lbPosition.positionData.lowerBinId,
    upperBin: lbPosition.positionData.upperBinId,
    activeBin: dlmmPool.lbPair.activeId,
  });
  const policy = basePolicy();
  const action = drillAction(position);

  console.log(`[RangeGuard Partial Drill] keeper=${health.keeper}`);
  console.log(`[RangeGuard Partial Drill] pool=${poolAddress}`);
  console.log(`[RangeGuard Partial Drill] position=${positionAddress}`);
  console.log("[RangeGuard Partial Drill] submitting phase-1-only rebalance to devnet keeper...");
  const receipt = await submitPartialFailureDrill(policy, action);
  const removeSignature = receipt.phaseResults?.find((phase) => phase.phaseId === "remove-old-position")?.signature || null;

  if (process.env.DATABASE_URL) {
    const database = await syncKeeperReceiptToDatabase(receipt);
    console.log(`[RangeGuard Partial Drill] prisma sync persisted=${database.persisted} reason=${database.reason}`);
  }

  const drillProof = {
    createdAt: new Date().toISOString(),
    rpc: process.env.SOLANA_RPC_URL || DEFAULT_RPC,
    keeper: health.keeper,
    riskAuthority: health.riskAuthority,
    poolAddress,
    oldPositionAddress: positionAddress,
    status: receipt.status,
    actionId: receipt.actionId,
    phase1Signature: removeSignature,
    phase2Submitted: false,
    tokenMetadata: receipt.tokenMetadata ?? null,
    recovery: receipt.recovery ?? null,
    receiptPath: receipt.receiptPath,
  };

  mkdirSync(dirname(resolve(DRILL_PROOF_PATH)), { recursive: true });
  writeFileSync(DRILL_PROOF_PATH, `${JSON.stringify(drillProof, null, 2)}\n`);

  console.log(`[RangeGuard Partial Drill] status=${receipt.status}`);
  console.log(`[RangeGuard Partial Drill] phase1=${removeSignature}`);
  console.log(`[RangeGuard Partial Drill] wrote ${DRILL_PROOF_PATH}`);
}

main().catch((error) => {
  console.error("[RangeGuard Partial Drill] failed");
  console.error(error);
  process.exitCode = 1;
});
