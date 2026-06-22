import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import DLMM from "@meteora-ag/dlmm";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";

import { attachGuardPlan } from "@/lib/autonomy/guardProgram";
import {
  buildGuardedWithdrawToOwnerPlan,
  buildMeteoraDlmmFullRebalanceDryRun,
  buildMeteoraDlmmRecoveryAddLiquidityPlan,
  type FullRebalanceDryRunPhase,
} from "@/lib/autonomy/meteoraTransactionBuilder";
import { phaseSignature, phaseSubmitted, persistKeeperExecutionReceipt, receiptNeedsRecovery } from "@/lib/autonomy/receiptStore";
import type {
  BotAction,
  BotPolicy,
  KeeperExecutionReceipt,
  KeeperReceiptTokenMetadata,
  KeeperReceiptTokenTransfer,
  KeeperRecoveryMode,
  KeeperRecoveryPlan,
} from "@/lib/types";

const DEFAULT_PORT = 8787;
const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
const MAX_BODY_BYTES = 1_000_000;
const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111";

type AccountMetaPayload = {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
};

type TargetInstructionPayload = {
  programId: string;
  keys?: AccountMetaPayload[];
  dataBase64?: string;
};

type KeeperPayload = {
  source?: string;
  requestType?: "GuardedInstruction" | "MeteoraFullRebalance" | "MeteoraRebalanceRecovery";
  policy?: Partial<BotPolicy> & {
    id?: string;
    policyHash?: string | null;
    onChainPolicyAddress?: string | null;
    guardProgramId?: string | null;
    delegatedAuthority?: string | null;
    riskAuthority?: string | null;
  };
  action?: Partial<BotAction> & {
    id?: string;
    type?: string;
    actionHash?: string;
    targetInstructionDigest?: string | null;
    notionalUsd?: number;
    estimatedSlippageBps?: number;
    proposedLowerBin?: number | null;
    proposedUpperBin?: number | null;
  };
  guardInstruction?: {
    dataBase64?: string | null;
    accounts?: AccountMetaPayload[];
  };
  targetProgramIds?: string[];
  targetInstructions?: TargetInstructionPayload[];
  dryRunAdditionalSigners?: Array<{
    publicKey?: string;
    secretKeyBase64?: string;
      purpose?: "MeteoraNewPosition";
    }>;
  fullRebalance?: {
    action?: BotAction;
    drill?: {
      forcePhase2Failure?: boolean;
      label?: string;
    };
  };
  recovery?: {
    mode?: KeeperRecoveryMode;
    receipt?: KeeperExecutionReceipt;
    ownerAddress?: string;
    tokenTransfers?: Array<{
      side?: "X" | "Y" | string;
      mint: string;
      amount: string;
      keeperTokenAccount?: string | null;
      ownerTokenAccount?: string | null;
      tokenProgramId?: string | null;
    }>;
  };
  transactionSteps?: string[];
};

type PhaseSubmitResult = {
  phaseId: FullRebalanceDryRunPhase["id"];
  status: "Simulated" | "Submitted";
  signature: string;
  targetInstructionDigest: string;
  targetProgramIds: string[];
  instructionCount: number;
  unitsConsumed: number | null;
};

function keypairFromEnv(name: string) {
  const path = process.env[name];
  if (!path) return null;

  const parsed = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function json(statusCode: number, payload: unknown) {
  return {
    statusCode,
    body: JSON.stringify(payload, null, 2),
  };
}

function pubkey(value: string | null | undefined, label: string) {
  if (!value) throw new Error(`${label} is required.`);
  return new PublicKey(value);
}

function accountMeta(account: AccountMetaPayload) {
  return {
    pubkey: new PublicKey(account.pubkey),
    isSigner: account.isSigner,
    isWritable: account.isWritable,
  };
}

function parseActionHashFromGuardData(data: Buffer) {
  if (data.length < 40) throw new Error("Guard instruction data is too short.");
  return data.subarray(8, 40).toString("hex");
}

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

function sha256Hex(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue(payload))).digest("hex");
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function sameStringSet(left: string[], right: string[]) {
  const sortedLeft = unique(left).sort();
  const sortedRight = unique(right).sort();

  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function isDevnetRuntime(rpcUrl: string) {
  const cluster = (process.env.SOLANA_CLUSTER || "").toLowerCase();
  const normalizedRpcUrl = rpcUrl.toLowerCase();

  return cluster === "devnet" || normalizedRpcUrl.includes("devnet");
}

function digestTargetInstructions(instructions: TargetInstructionPayload[]) {
  return sha256Hex(
    instructions.map((instruction) => ({
      programId: instruction.programId,
      keys: (instruction.keys || []).map((key) => ({
        pubkey: key.pubkey,
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
      dataBase64: instruction.dataBase64 || "",
    })),
  );
}

function additionalSignerKeypairs(payload: KeeperPayload, dryRun: boolean) {
  const signers = payload.dryRunAdditionalSigners || [];
  if (signers.length === 0) return [];
  if (!dryRun) throw new Error("Additional signer keypairs are allowed only in keeper dry-run mode.");

  return signers.map((signer) => {
    if (signer.purpose !== "MeteoraNewPosition") {
      throw new Error("Unsupported additional signer purpose.");
    }

    if (!signer.publicKey || !signer.secretKeyBase64) {
      throw new Error("Additional signer public key and secret key are required.");
    }

    const keypair = Keypair.fromSecretKey(Buffer.from(signer.secretKeyBase64, "base64"));
    if (keypair.publicKey.toBase58() !== signer.publicKey) {
      throw new Error(`Additional signer key mismatch for ${signer.publicKey}.`);
    }

    return keypair;
  });
}

function assertTargetInstructionPayload(payload: KeeperPayload, keeper: Keypair, additionalSigners: Keypair[]) {
  const targetInstructions = payload.targetInstructions || [];
  if (targetInstructions.length === 0) return;
  const additionalSignerKeys = new Set(additionalSigners.map((signer) => signer.publicKey.toBase58()));
  const additionalSignerUsage = new Set<string>();

  if (!payload.action?.targetInstructionDigest) {
    throw new Error("Target instruction digest is required when target instructions are present.");
  }

  const digest = digestTargetInstructions(targetInstructions);
  if (digest !== payload.action.targetInstructionDigest) {
    throw new Error("Target instruction digest does not match payload instructions.");
  }

  const targetProgramIds = payload.targetProgramIds || [];
  const instructionProgramIds = targetInstructions.map((instruction) => instruction.programId);
  if (!sameStringSet(targetProgramIds, instructionProgramIds)) {
    throw new Error("Target program ids must exactly match the submitted target instructions.");
  }

  for (const instruction of targetInstructions) {
    for (const account of instruction.keys || []) {
      if (account.isSigner && account.pubkey !== keeper.publicKey.toBase58() && !additionalSignerKeys.has(account.pubkey)) {
        throw new Error(`Target instruction requires an unsupported signer: ${account.pubkey}.`);
      }
      if (account.isSigner && additionalSignerKeys.has(account.pubkey)) {
        additionalSignerUsage.add(account.pubkey);
      }
    }
  }

  for (const signer of additionalSignerKeys) {
    if (!additionalSignerUsage.has(signer)) {
      throw new Error(`Additional signer ${signer} is not required by the target instructions.`);
    }
  }
}

function assertPayload(payload: KeeperPayload, keeper: Keypair, riskAuthority: Keypair) {
  if (payload.source !== "rangeguard-autonomy") throw new Error("Invalid payload source.");
  if (!payload.action?.id || !payload.action.actionHash) throw new Error("Missing action id or action hash.");
  if (!/^[0-9a-f]{64}$/i.test(payload.action.actionHash)) throw new Error("Invalid action hash.");

  const guardProgramId = pubkey(payload.policy?.guardProgramId, "policy.guardProgramId");
  pubkey(payload.policy?.onChainPolicyAddress, "policy.onChainPolicyAddress");
  const delegatedAuthority = pubkey(payload.policy?.delegatedAuthority, "policy.delegatedAuthority");
  const riskAuthorityKey = pubkey(payload.policy?.riskAuthority, "policy.riskAuthority");

  if (!delegatedAuthority.equals(keeper.publicKey)) {
    throw new Error(`Keeper key mismatch. Payload expects ${delegatedAuthority.toBase58()}.`);
  }

  if (!riskAuthorityKey.equals(riskAuthority.publicKey)) {
    throw new Error(`Risk authority key mismatch. Payload expects ${riskAuthorityKey.toBase58()}.`);
  }

  if (keeper.publicKey.equals(riskAuthority.publicKey)) {
    throw new Error("Keeper and risk authority must be different keypairs.");
  }

  if (!payload.guardInstruction?.dataBase64 || !payload.guardInstruction.accounts) {
    throw new Error("Missing guard instruction.");
  }

  const guardData = Buffer.from(payload.guardInstruction.dataBase64, "base64");
  const guardHash = parseActionHashFromGuardData(guardData);
  if (guardHash !== payload.action.actionHash.toLowerCase()) {
    throw new Error("Guard instruction action hash does not match payload action hash.");
  }

  const accounts = payload.guardInstruction.accounts;
  if (accounts.length !== 4) throw new Error("Guard instruction must include policy, keeper, risk authority, and instructions sysvar.");
  if (accounts[1]?.pubkey !== keeper.publicKey.toBase58() || !accounts[1]?.isSigner) {
    throw new Error("Guard keeper signer account is missing or mismatched.");
  }
  if (accounts[2]?.pubkey !== riskAuthority.publicKey.toBase58() || !accounts[2]?.isSigner) {
    throw new Error("Guard risk authority signer account is missing or mismatched.");
  }
  if (accounts[3]?.pubkey !== INSTRUCTIONS_SYSVAR) {
    throw new Error("Guard instructions sysvar account is missing.");
  }

  return { guardProgramId, guardData, accounts };
}

function buildTargetInstructions(payload: KeeperPayload) {
  return (payload.targetInstructions || []).map(
    (instruction) =>
      new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: (instruction.keys || []).map(accountMeta),
        data: Buffer.from(instruction.dataBase64 || "", "base64"),
      }),
  );
}

function normalizedPolicy(payload: KeeperPayload, keeper: Keypair, riskAuthority: Keypair): BotPolicy {
  const now = new Date().toISOString();
  const policy = payload.policy || {};

  return {
    id: policy.id || "keeper-live-policy",
    userId: policy.userId || payload.fullRebalance?.action?.userId || "keeper-live-user",
    name: policy.name || "Keeper Live Policy",
    mode: policy.mode || "DelegatedAutonomy",
    status: policy.status || "Armed",
    executionMode: policy.executionMode || "DelegatedGuarded",
    maxPositionSizeUsd: policy.maxPositionSizeUsd ?? Number(payload.action?.notionalUsd ?? 0),
    dailyNotionalLimitUsd: policy.dailyNotionalLimitUsd ?? Number(payload.action?.notionalUsd ?? 0),
    maxSlippageBps: policy.maxSlippageBps ?? Number(payload.action?.estimatedSlippageBps ?? 0),
    maxPoolRiskScore: policy.maxPoolRiskScore ?? 100,
    minPoolLiquidityUsd: policy.minPoolLiquidityUsd ?? 0,
    maxOpenPositions: policy.maxOpenPositions ?? 10,
    dailyRebalanceLimit: policy.dailyRebalanceLimit ?? 1,
    stopLossPct: policy.stopLossPct ?? 0,
    takeProfitPct: policy.takeProfitPct ?? 0,
    allowedPoolTypes: policy.allowedPoolTypes || ["Stable", "Blue-chip", "Any"],
    allowedPoolAddresses: policy.allowedPoolAddresses || [],
    requireSimulation: policy.requireSimulation ?? true,
    requireWalletConfirm: policy.requireWalletConfirm ?? false,
    guardProgramId: policy.guardProgramId || null,
    onChainPolicyAddress: policy.onChainPolicyAddress || null,
    delegatedAuthority: policy.delegatedAuthority || keeper.publicKey.toBase58(),
    riskAuthority: policy.riskAuthority || riskAuthority.publicKey.toBase58(),
    policyHash: policy.policyHash || null,
    createdAt: policy.createdAt || now,
    updatedAt: policy.updatedAt || now,
  };
}

function payloadForPhase(policy: BotPolicy, action: BotAction, phase: FullRebalanceDryRunPhase): KeeperPayload {
  const actionForPhase = attachGuardPlan(policy, {
    ...action,
    id: `${action.id}-${phase.id}-live`,
    title: phase.label,
    transactionPlan: {
      ...action.transactionPlan,
      steps: [phase.detail],
      targetInstructions: phase.targetInstructions,
      targetInstructionDigest: phase.targetInstructionDigest,
      targetProgramIds: phase.targetProgramIds,
      targetInstructionBuilder: {
        source: "Meteora DLMM",
        status: "Built",
        detail: phase.detail,
        instructionCount: phase.instructionCount,
        transactionCount: phase.transactionCount,
        requiredSigners: phase.requiredSigners,
        targetProgramIds: phase.targetProgramIds,
      },
    },
  });

  return {
    source: "rangeguard-autonomy",
    requestType: "GuardedInstruction",
    policy,
    action: {
      id: actionForPhase.id,
      type: actionForPhase.type,
      actionHash: actionForPhase.transactionPlan.actionHash,
      targetInstructionDigest: actionForPhase.transactionPlan.targetInstructionDigest,
      notionalUsd: actionForPhase.notionalUsd,
      estimatedSlippageBps: actionForPhase.estimatedSlippageBps,
      proposedLowerBin: actionForPhase.proposedLowerBin,
      proposedUpperBin: actionForPhase.proposedUpperBin,
    },
    guardInstruction: {
      dataBase64: actionForPhase.transactionPlan.guardInstructionBase64,
      accounts: actionForPhase.transactionPlan.guardAccounts,
    },
    targetProgramIds: actionForPhase.transactionPlan.targetProgramIds,
    targetInstructions: actionForPhase.transactionPlan.targetInstructions,
    transactionSteps: actionForPhase.transactionPlan.steps,
  };
}

async function submitLivePhase({
  connection,
  keeper,
  riskAuthority,
  policy,
  action,
  phase,
  additionalSigners,
  broadcast = true,
}: {
  connection: Connection;
  keeper: Keypair;
  riskAuthority: Keypair;
  policy: BotPolicy;
  action: BotAction;
  phase: FullRebalanceDryRunPhase;
  additionalSigners: Keypair[];
  broadcast?: boolean;
}): Promise<PhaseSubmitResult> {
  const phasePayload = payloadForPhase(policy, action, phase);
  const guard = assertPayload(phasePayload, keeper, riskAuthority);

  assertTargetInstructionPayload(phasePayload, keeper, additionalSigners);
  const targetInstructions = buildTargetInstructions(phasePayload);
  const tx = new Transaction();
  tx.feePayer = keeper.publicKey;
  tx.add(
    new TransactionInstruction({
      programId: guard.guardProgramId,
      keys: guard.accounts.map(accountMeta),
      data: guard.guardData,
    }),
    ...targetInstructions,
  );
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(keeper, riskAuthority, ...additionalSigners);

  const simulation = await connection.simulateTransaction(tx);
  if (simulation.value.err) {
    throw new Error(`Live ${phase.id} simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  if (!broadcast) {
    return {
      phaseId: phase.id,
      status: "Simulated",
      signature: `simulated-${phase.targetInstructionDigest.slice(0, 24)}`,
      targetInstructionDigest: phase.targetInstructionDigest,
      targetProgramIds: phase.targetProgramIds,
      instructionCount: phase.instructionCount,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
    };
  }

  const signature = await sendAndConfirmRawTransaction(connection, tx.serialize(), {
    commitment: "confirmed",
  });

  return {
    phaseId: phase.id,
    status: "Submitted",
    signature,
    targetInstructionDigest: phase.targetInstructionDigest,
    targetProgramIds: phase.targetProgramIds,
    instructionCount: phase.instructionCount,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
  };
}

async function verifyFullRebalancePostflight({
  connection,
  action,
  keeper,
  oldPositionAddress,
  newPositionAddress,
  expectedLowerBin,
  expectedUpperBin,
}: {
  connection: Connection;
  action: BotAction;
  keeper: Keypair;
  oldPositionAddress: string;
  newPositionAddress: string;
  expectedLowerBin: number | null;
  expectedUpperBin: number | null;
}) {
  if (!action.position?.pool.poolAddress) {
    throw new Error("Postflight verification requires a pool address.");
  }

  const oldPosition = new PublicKey(oldPositionAddress);
  const newPosition = new PublicKey(newPositionAddress);
  const poolAddress = new PublicKey(action.position.pool.poolAddress);
  const [oldPositionAccount, dlmmPool] = await Promise.all([
    connection.getAccountInfo(oldPosition, "confirmed"),
    DLMM.create(connection, poolAddress, { cluster: "devnet" }),
  ]);
  const newLbPosition = await dlmmPool.getPosition(newPosition);
  const actualOwner = newLbPosition.positionData.owner.toBase58();
  const actualLowerBin = newLbPosition.positionData.lowerBinId;
  const actualUpperBin = newLbPosition.positionData.upperBinId;
  const checks = [
    {
      id: "old-position-closed",
      passed: oldPositionAccount === null,
      detail: oldPositionAccount === null ? "Old position account is closed." : "Old position account still exists.",
    },
    {
      id: "new-position-owner",
      passed: actualOwner === keeper.publicKey.toBase58(),
      detail: `New position owner is ${actualOwner}.`,
    },
    {
      id: "new-position-lower-bin",
      passed: expectedLowerBin === null || actualLowerBin === expectedLowerBin,
      detail: `Expected lower bin ${expectedLowerBin}, found ${actualLowerBin}.`,
    },
    {
      id: "new-position-upper-bin",
      passed: expectedUpperBin === null || actualUpperBin === expectedUpperBin,
      detail: `Expected upper bin ${expectedUpperBin}, found ${actualUpperBin}.`,
    },
  ];

  return {
    ok: checks.every((check) => check.passed),
    newPositionAddress,
    oldPositionClosed: oldPositionAccount === null,
    owner: actualOwner,
    lowerBin: actualLowerBin,
    upperBin: actualUpperBin,
    activeBin: dlmmPool.lbPair.activeId,
    checks,
  };
}

function tokenTransfersFromMetadata(tokenMetadata: KeeperReceiptTokenMetadata | null | undefined): KeeperReceiptTokenTransfer[] {
  return (tokenMetadata?.transfers || []).map((transfer) => ({
    side: transfer.side,
    mint: transfer.mint,
    amount: transfer.amount,
    keeperTokenAccount: transfer.keeperTokenAccount ?? null,
    ownerTokenAccount: transfer.ownerTokenAccount ?? null,
    tokenProgramId: transfer.tokenProgramId ?? null,
    signature: transfer.signature ?? null,
  }));
}

function recoverySourceFromReceipt(receipt: KeeperExecutionReceipt) {
  return {
    actionId: receipt.actionId,
    startedAt: receipt.startedAt,
    phase1Signature: phaseSignature(receipt, "remove-old-position"),
  };
}

function recoveryRequiredPlan({
  actionId,
  reason,
  expectedLowerBin,
  expectedUpperBin,
  tokenMetadata,
}: {
  actionId: string | null | undefined;
  reason: string;
  expectedLowerBin: number | null | undefined;
  expectedUpperBin: number | null | undefined;
  tokenMetadata?: KeeperReceiptTokenMetadata | null;
}): KeeperRecoveryPlan {
  const tokenTransfers = tokenTransfersFromMetadata(tokenMetadata);

  return {
    required: true,
    state: "RecoveryRequired",
    reason,
    sourceReceiptActionId: actionId || null,
    retryAddLiquidity: {
      status: expectedLowerBin === null || expectedLowerBin === undefined || expectedUpperBin === null || expectedUpperBin === undefined
        ? "Blocked"
        : "Available",
      reason:
        expectedLowerBin === null || expectedLowerBin === undefined || expectedUpperBin === null || expectedUpperBin === undefined
          ? "The original range is missing, so the retry cannot be safely built."
          : "Reuse the original range and generate a fresh new-position signer.",
      expectedLowerBin: expectedLowerBin ?? null,
      expectedUpperBin: expectedUpperBin ?? null,
      freshNewPositionAddress: null,
    },
    withdrawToOwner: {
      status: tokenTransfers.length > 0 ? "Available" : "Blocked",
      reason:
        tokenTransfers.length > 0
          ? "Use only if retry is unsafe. Token mint and amount details were captured from the live receipt."
          : "Use only if retry is unsafe. Requires explicit owner wallet, token mint, and token amount inputs before building guarded transfers.",
      ownerAddress: null,
      tokenTransfers,
    },
  };
}

function recoveryActionFromReceipt(
  receipt: KeeperExecutionReceipt,
  policy: BotPolicy,
  mode: KeeperRecoveryMode,
): BotAction {
  const now = new Date().toISOString();
  const lowerBin = receipt.expectedNewLowerBin ?? receipt.proposedLowerBin ?? 0;
  const upperBin = receipt.expectedNewUpperBin ?? receipt.proposedUpperBin ?? 0;
  const actionId = `${receipt.actionId || "recovery"}-${mode}-${Date.now()}`;

  return {
    id: actionId,
    userId: "rangeguard-devnet-keeper",
    policyId: policy.id,
    runId: null,
    positionId: receipt.oldPositionAddress || null,
    type: mode === "WithdrawToOwner" ? "ClosePosition" : "Rebalance",
    status: "Queued",
    priority: "High",
    protocol: "Meteora DLMM",
    title: mode === "WithdrawToOwner" ? "Withdraw recovery funds to owner" : "Retry recovery add-liquidity",
    reason:
      mode === "WithdrawToOwner"
        ? "Fallback recovery path for keeper-held tokens after a partial rebalance."
        : "Retry the add-liquidity phase after a partial rebalance.",
    notionalUsd: receipt.notionalUsd || 0,
    estimatedFeeUsd: 0,
    estimatedSlippageBps: receipt.estimatedSlippageBps || 0,
    proposedLowerBin: lowerBin,
    proposedUpperBin: upperBin,
    simulationStatus: "Passed",
    executionStatus: "Ready",
    guardrailResults: [],
    transactionPlan: {
      steps: [],
      requiresWalletSignature: false,
      requiresDelegatedAuthority: true,
      guardProgramId: policy.guardProgramId,
      onChainPolicyAddress: policy.onChainPolicyAddress,
      targetInstructions: [],
      targetInstructionDigest: null,
      targetProgramIds: [],
    },
    createdAt: now,
    queuedAt: now,
    executedAt: null,
    resolvedAt: null,
    position: {
      id: receipt.oldPositionAddress || actionId,
      userId: "rangeguard-devnet-keeper",
      strategyId: null,
      poolId: receipt.poolAddress || "unknown-devnet-pool",
      positionAddress: receipt.oldPositionAddress,
      entryValueUsd: receipt.notionalUsd || 0,
      currentValueUsd: 0,
      estimatedPnlUsd: 0,
      estimatedPnlPct: 0,
      feesEarnedUsd: 0,
      lowerBin,
      upperBin,
      activeBinAtEntry: null,
      currentActiveBin: null,
      healthStatus: "Closed",
      healthScore: 0,
      suggestedAction: "Rebalance",
      status: "Closed",
      recoveryStatus: "RecoveryRequired",
      openedAt: receipt.startedAt,
      closedAt: receipt.completedAt || null,
      createdAt: receipt.startedAt,
      updatedAt: receipt.completedAt || receipt.persistedAt || receipt.startedAt,
      pool: {
        id: receipt.poolAddress || "unknown-devnet-pool",
        poolAddress: receipt.poolAddress || "unknown-devnet-pool",
        tokenASymbol: "DLMM-A",
        tokenBSymbol: "DLMM-B",
        protocol: "Meteora DLMM",
        riskLabel: "Low",
        riskScore: 20,
        liquidityUsd: 0,
        poolType: "Any",
      },
      healthTimeline: [],
      feeTimeline: [],
      pnlTimeline: [],
    },
  };
}

async function executeLiveFullRebalance(
  payload: KeeperPayload,
  keeper: Keypair,
  riskAuthority: Keypair,
  connection: Connection,
  dryRun: boolean,
) {
  const rpcUrl = process.env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC;
  const startedAt = new Date().toISOString();
  const policy = normalizedPolicy(payload, keeper, riskAuthority);
  const action = payload.fullRebalance?.action;
  const partialFailureDrill = payload.fullRebalance?.drill?.forcePhase2Failure === true;
  const phaseResults: PhaseSubmitResult[] = [];
  let generatedNewPositionAddress: string | null = null;
  let buildSummary: Record<string, unknown> | null = null;
  let expectedNewLowerBin: number | null = null;
  let expectedNewUpperBin: number | null = null;
  let estimatedDepositXAmount: string | null = null;
  let estimatedDepositYAmount: string | null = null;
  let tokenMetadata: KeeperReceiptTokenMetadata | null = null;
  const receiptBase = {
    source: "rangeguard-autonomy",
    requestType: "MeteoraFullRebalance",
    actionId: action?.id || payload.action?.id || null,
    policyId: policy.id,
    poolAddress: action?.position?.pool.poolAddress || null,
    oldPositionAddress: action?.position?.positionAddress || null,
    notionalUsd: action?.notionalUsd ?? payload.action?.notionalUsd ?? null,
    estimatedSlippageBps: action?.estimatedSlippageBps ?? payload.action?.estimatedSlippageBps ?? null,
    proposedLowerBin: action?.proposedLowerBin ?? payload.action?.proposedLowerBin ?? null,
    proposedUpperBin: action?.proposedUpperBin ?? payload.action?.proposedUpperBin ?? null,
    startedAt,
  };

  try {
    if (payload.source !== "rangeguard-autonomy") throw new Error("Invalid payload source.");
    if (dryRun) throw new Error("Live full rebalance requires RANGEGUARD_KEEPER_DRY_RUN=false.");
    if (process.env.AUTONOMY_DEVNET_LIVE_REBALANCE !== "true") {
      throw new Error("AUTONOMY_DEVNET_LIVE_REBALANCE=true is required for live full rebalance.");
    }
    if (partialFailureDrill && process.env.RANGEGUARD_PARTIAL_FAILURE_DRILL !== "true") {
      throw new Error("RANGEGUARD_PARTIAL_FAILURE_DRILL=true is required for the intentional phase-2 failure drill.");
    }
    if (!isDevnetRuntime(rpcUrl)) {
      throw new Error("Live full rebalance is devnet-only. Set SOLANA_CLUSTER=devnet or use a devnet RPC URL.");
    }
    if (payload.dryRunAdditionalSigners?.length) {
      throw new Error("Client-supplied additional signers are never accepted for live full rebalance.");
    }
    if (!action) throw new Error("fullRebalance.action is required.");
    if (action.type !== "Rebalance") throw new Error("Live full rebalance only supports Rebalance actions.");
    if (!action.position?.positionAddress) throw new Error("Live full rebalance requires an existing position address.");

    const policyProbePayload: KeeperPayload = {
      source: "rangeguard-autonomy",
      policy,
      action: {
        id: action.id,
        type: action.type,
        actionHash: "0".repeat(64),
      },
      guardInstruction: {
        dataBase64: Buffer.concat([Buffer.alloc(8), Buffer.alloc(32)]).toString("base64"),
        accounts: [
          { pubkey: pubkey(policy.onChainPolicyAddress, "policy.onChainPolicyAddress").toBase58(), isSigner: false, isWritable: true },
          { pubkey: keeper.publicKey.toBase58(), isSigner: true, isWritable: false },
          { pubkey: riskAuthority.publicKey.toBase58(), isSigner: true, isWritable: false },
          { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
        ],
      },
    };
    assertPayload(policyProbePayload, keeper, riskAuthority);

    const newPosition = Keypair.generate();
    generatedNewPositionAddress = newPosition.publicKey.toBase58();
    const build = await buildMeteoraDlmmFullRebalanceDryRun({
      policy,
      action,
      ownerAddress: keeper.publicKey.toBase58(),
      newPositionAddress: newPosition.publicKey,
    });
    buildSummary = {
      status: build.status,
      detail: build.detail,
      oldPositionAddress: build.oldPositionAddress,
      newPositionAddress: build.newPositionAddress,
      expectedNewLowerBin: build.expectedNewLowerBin,
      expectedNewUpperBin: build.expectedNewUpperBin,
      estimatedDepositXAmount: build.estimatedDepositXAmount,
      estimatedDepositYAmount: build.estimatedDepositYAmount,
      tokenMetadata: build.tokenMetadata ?? null,
    };
    expectedNewLowerBin = build.expectedNewLowerBin;
    expectedNewUpperBin = build.expectedNewUpperBin;
    estimatedDepositXAmount = build.estimatedDepositXAmount;
    estimatedDepositYAmount = build.estimatedDepositYAmount;
    tokenMetadata = build.tokenMetadata ?? null;

    if (build.status !== "Built") {
      throw new Error(`Full rebalance builder returned ${build.status}: ${build.detail}`);
    }

    for (const phase of build.phases) {
      const additionalSigners = phase.additionalSignerPublicKeys.includes(newPosition.publicKey.toBase58())
        ? [newPosition]
        : [];
      const result = await submitLivePhase({
        connection,
        keeper,
        riskAuthority,
        policy,
        action,
        phase,
        additionalSigners,
      });

      phaseResults.push(result);

      if (partialFailureDrill && phase.id === "remove-old-position") {
        throw new Error(
          `Intentional devnet partial-failure drill${payload.fullRebalance?.drill?.label ? ` (${payload.fullRebalance.drill.label})` : ""}: phase 1 was submitted and phase 2 was skipped.`,
        );
      }
    }

    if (!build.oldPositionAddress || !build.newPositionAddress) {
      throw new Error("Full rebalance builder did not return both old and new position addresses.");
    }

    const postflight = await verifyFullRebalancePostflight({
      connection,
      action,
      keeper,
      oldPositionAddress: build.oldPositionAddress,
      newPositionAddress: build.newPositionAddress,
      expectedLowerBin: build.expectedNewLowerBin,
      expectedUpperBin: build.expectedNewUpperBin,
    });
    const receipt = {
      ...receiptBase,
      status: postflight.ok ? "Executed" : "PostflightFailed",
      completedAt: new Date().toISOString(),
      newPositionAddress: build.newPositionAddress,
      estimatedDepositXAmount: build.estimatedDepositXAmount,
      estimatedDepositYAmount: build.estimatedDepositYAmount,
      expectedNewLowerBin: build.expectedNewLowerBin,
      expectedNewUpperBin: build.expectedNewUpperBin,
      tokenMetadata,
      drill: partialFailureDrill
        ? {
            type: "ForcedPhase2Failure",
            label: payload.fullRebalance?.drill?.label || null,
            forcePhase2Failure: true,
          }
        : null,
      phaseResults,
      postflight,
    };

    const persisted = await persistKeeperExecutionReceipt(receipt);

    return json(postflight.ok ? 202 : 409, {
      ...receipt,
      ok: postflight.ok,
      dryRun,
      submitted: postflight.ok,
      receiptPath: persisted.path,
      databasePersistence: persisted.database,
    });
  } catch (error) {
    const recoveryRequired =
      phaseResults.some((phase) => phase.phaseId === "remove-old-position" && phase.status === "Submitted") &&
      !phaseResults.some((phase) => phase.phaseId === "add-new-position" && phase.status === "Submitted");
    const errorMessage = error instanceof Error ? error.message : "Live full rebalance failed.";
    const receipt = {
      ...receiptBase,
      status: recoveryRequired ? "RecoveryRequired" : "Failed",
      completedAt: new Date().toISOString(),
      newPositionAddress: recoveryRequired ? null : generatedNewPositionAddress,
      estimatedDepositXAmount,
      estimatedDepositYAmount,
      expectedNewLowerBin,
      expectedNewUpperBin,
      tokenMetadata,
      drill: partialFailureDrill
        ? {
            type: "ForcedPhase2Failure",
            label: payload.fullRebalance?.drill?.label || null,
            forcePhase2Failure: true,
          }
        : null,
      build: buildSummary,
      phaseResults,
      recovery: recoveryRequired
        ? recoveryRequiredPlan({
            actionId: receiptBase.actionId,
            reason: partialFailureDrill
              ? errorMessage
              : "Phase 1 was submitted, but phase 2 add-liquidity did not complete.",
            expectedLowerBin: expectedNewLowerBin,
            expectedUpperBin: expectedNewUpperBin,
            tokenMetadata,
          })
        : undefined,
      error: errorMessage,
    };

    const persisted = await persistKeeperExecutionReceipt(receipt);

    return json(recoveryRequired ? 409 : 400, {
      ...receipt,
      ok: false,
      dryRun,
      submitted: false,
      receiptPath: persisted.path,
      databasePersistence: persisted.database,
    });
  }
}

async function executeRecoveryRequest(
  payload: KeeperPayload,
  keeper: Keypair,
  riskAuthority: Keypair,
  connection: Connection,
  dryRun: boolean,
) {
  const rpcUrl = process.env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC;
  const startedAt = new Date().toISOString();
  const policy = normalizedPolicy(payload, keeper, riskAuthority);
  const mode = payload.recovery?.mode;
  const sourceReceipt = payload.recovery?.receipt;
  const phaseResults: PhaseSubmitResult[] = [];
  let buildSummary: Record<string, unknown> | null = null;
  let generatedNewPositionAddress: string | null = null;

  try {
    if (payload.source !== "rangeguard-autonomy") throw new Error("Invalid payload source.");
    if (!isDevnetRuntime(rpcUrl)) {
      throw new Error("Recovery execution is devnet-only. Set SOLANA_CLUSTER=devnet or use a devnet RPC URL.");
    }
    if (!dryRun && process.env.AUTONOMY_DEVNET_LIVE_REBALANCE !== "true") {
      throw new Error("AUTONOMY_DEVNET_LIVE_REBALANCE=true is required for live recovery execution.");
    }
    if (payload.dryRunAdditionalSigners?.length) {
      throw new Error("Client-supplied additional signers are never accepted for recovery execution.");
    }
    if (!sourceReceipt) throw new Error("recovery.receipt is required.");
    if (!receiptNeedsRecovery(sourceReceipt)) {
      throw new Error("Recovery requests require a receipt with phase 1 submitted and no successful phase 2.");
    }
    if (!phaseSubmitted(sourceReceipt, "remove-old-position") && sourceReceipt.status !== "RecoveryRequired") {
      throw new Error("Recovery requests require a submitted phase 1 signature.");
    }
    if (mode !== "RetryAddLiquidity" && mode !== "WithdrawToOwner") {
      throw new Error("recovery.mode must be RetryAddLiquidity or WithdrawToOwner.");
    }

    const action = recoveryActionFromReceipt(sourceReceipt, policy, mode);
    const newPosition = mode === "RetryAddLiquidity" ? Keypair.generate() : null;
    generatedNewPositionAddress = newPosition?.publicKey.toBase58() || null;
    const recoveryTokenTransfers =
      payload.recovery?.tokenTransfers && payload.recovery.tokenTransfers.length > 0
        ? payload.recovery.tokenTransfers
        : tokenTransfersFromMetadata(sourceReceipt.tokenMetadata);
    const build =
      mode === "RetryAddLiquidity"
        ? await buildMeteoraDlmmRecoveryAddLiquidityPlan({
            policy,
            receipt: sourceReceipt,
            ownerAddress: keeper.publicKey.toBase58(),
            newPositionAddress: newPosition!.publicKey,
          })
        : buildGuardedWithdrawToOwnerPlan({
            policy,
            receipt: sourceReceipt,
            ownerAddress: payload.recovery?.ownerAddress || "",
            tokenTransfers: recoveryTokenTransfers,
          });

    buildSummary = {
      status: build.status,
      detail: build.detail,
      oldPositionAddress: build.oldPositionAddress,
      newPositionAddress: build.newPositionAddress,
      expectedNewLowerBin: build.expectedNewLowerBin,
      expectedNewUpperBin: build.expectedNewUpperBin,
      estimatedDepositXAmount: build.estimatedDepositXAmount,
      estimatedDepositYAmount: build.estimatedDepositYAmount,
      tokenMetadata: build.tokenMetadata ?? sourceReceipt.tokenMetadata ?? null,
    };

    if (build.status !== "Built") {
      throw new Error(`Recovery builder returned ${build.status}: ${build.detail}`);
    }

    const phase = build.phases[0];
    if (!phase) throw new Error("Recovery builder did not return a guarded phase.");

    const additionalSigners =
      newPosition && phase.additionalSignerPublicKeys.includes(newPosition.publicKey.toBase58()) ? [newPosition] : [];
    const result = await submitLivePhase({
      connection,
      keeper,
      riskAuthority,
      policy,
      action,
      phase,
      additionalSigners,
      broadcast: !dryRun,
    });

    phaseResults.push(result);

    const recovery: KeeperRecoveryPlan =
      mode === "RetryAddLiquidity"
        ? {
            required: dryRun,
            state: dryRun ? "RetrySimulated" : "RetrySubmitted",
            reason: dryRun
              ? "Recovery retry simulated successfully. No transaction was broadcast."
              : "Recovery retry submitted with a fresh new-position signer.",
            sourceReceiptActionId: sourceReceipt.actionId,
            retryAddLiquidity: {
              status: dryRun ? "Simulated" : "Submitted",
              reason: "Reused the original receipt range and keeper token accounts.",
              expectedLowerBin: build.expectedNewLowerBin,
              expectedUpperBin: build.expectedNewUpperBin,
              freshNewPositionAddress: generatedNewPositionAddress,
              signature: result.signature,
            },
            withdrawToOwner: {
              status: "Available",
              reason: "Fallback remains available if postflight verification fails.",
              ownerAddress: payload.recovery?.ownerAddress || null,
              tokenTransfers: recoveryTokenTransfers,
            },
          }
        : {
            required: dryRun,
            state: dryRun ? "WithdrawSimulated" : "WithdrawSubmitted",
            reason: dryRun
              ? "Withdraw-to-owner fallback simulated successfully. No transaction was broadcast."
              : "Withdraw-to-owner fallback submitted through the guard policy.",
            sourceReceiptActionId: sourceReceipt.actionId,
            withdrawToOwner: {
              status: dryRun ? "Simulated" : "Submitted",
              reason: "Moved keeper-held token balances back to the owner wallet.",
              ownerAddress: payload.recovery?.ownerAddress || null,
              tokenTransfers: recoveryTokenTransfers.map((transfer) => ({
                ...transfer,
                signature: result.signature,
              })),
            },
          };

    if (dryRun) {
      return json(202, {
        ok: true,
        dryRun,
        submitted: false,
        status: result.status,
        mode,
        build: buildSummary,
        phaseResults,
        recovery,
      });
    }

    let postflight: Awaited<ReturnType<typeof verifyFullRebalancePostflight>> | undefined;
    if (mode === "RetryAddLiquidity") {
      if (!build.oldPositionAddress || !build.newPositionAddress) {
        throw new Error("Retry recovery postflight requires old and new position addresses.");
      }
      postflight = await verifyFullRebalancePostflight({
        connection,
        action,
        keeper,
        oldPositionAddress: build.oldPositionAddress,
        newPositionAddress: build.newPositionAddress,
        expectedLowerBin: build.expectedNewLowerBin,
        expectedUpperBin: build.expectedNewUpperBin,
      });
    }

    if (postflight && !postflight.ok) {
      recovery.required = true;
      recovery.state = "RecoveryRequired";
      recovery.reason = "Recovery retry submitted, but postflight verification failed.";
      recovery.withdrawToOwner = {
        status: "Available",
        reason: "Fallback remains available because the retry did not pass postflight verification.",
        ownerAddress: payload.recovery?.ownerAddress || null,
        tokenTransfers: recoveryTokenTransfers,
      };
    }

    const receipt: KeeperExecutionReceipt = {
      source: "rangeguard-autonomy",
      requestType: "MeteoraRebalanceRecovery",
      actionId: action.id,
      policyId: policy.id,
      poolAddress: sourceReceipt.poolAddress,
      oldPositionAddress: sourceReceipt.oldPositionAddress,
      newPositionAddress: build.newPositionAddress,
      notionalUsd: sourceReceipt.notionalUsd ?? null,
      estimatedSlippageBps: sourceReceipt.estimatedSlippageBps ?? null,
      proposedLowerBin: sourceReceipt.proposedLowerBin ?? null,
      proposedUpperBin: sourceReceipt.proposedUpperBin ?? null,
      startedAt,
      completedAt: new Date().toISOString(),
      status: postflight ? (postflight.ok ? "Executed" : "PostflightFailed") : "Executed",
      estimatedDepositXAmount: build.estimatedDepositXAmount,
      estimatedDepositYAmount: build.estimatedDepositYAmount,
      expectedNewLowerBin: build.expectedNewLowerBin,
      expectedNewUpperBin: build.expectedNewUpperBin,
      tokenMetadata: build.tokenMetadata ?? sourceReceipt.tokenMetadata ?? null,
      phaseResults,
      recoverySource: recoverySourceFromReceipt(sourceReceipt),
      recovery,
      postflight,
    };
    const persisted = await persistKeeperExecutionReceipt(receipt);

    return json(receipt.status === "Executed" ? 202 : 409, {
      ...receipt,
      ok: receipt.status === "Executed",
      dryRun,
      submitted: true,
      receiptPath: persisted.path,
      databasePersistence: persisted.database,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Recovery execution failed.";
    const receipt: KeeperExecutionReceipt | null =
      dryRun || !sourceReceipt
        ? null
        : {
            source: "rangeguard-autonomy",
            requestType: "MeteoraRebalanceRecovery",
            actionId: `${sourceReceipt.actionId || "recovery"}-${mode || "Unknown"}-${Date.now()}`,
            policyId: policy.id,
            poolAddress: sourceReceipt.poolAddress,
            oldPositionAddress: sourceReceipt.oldPositionAddress,
            newPositionAddress: generatedNewPositionAddress,
            notionalUsd: sourceReceipt.notionalUsd ?? null,
            estimatedSlippageBps: sourceReceipt.estimatedSlippageBps ?? null,
            proposedLowerBin: sourceReceipt.proposedLowerBin ?? null,
            proposedUpperBin: sourceReceipt.proposedUpperBin ?? null,
            startedAt,
            completedAt: new Date().toISOString(),
            status: "RecoveryRequired",
            estimatedDepositXAmount: sourceReceipt.estimatedDepositXAmount ?? null,
            estimatedDepositYAmount: sourceReceipt.estimatedDepositYAmount ?? null,
            expectedNewLowerBin: sourceReceipt.expectedNewLowerBin ?? null,
            expectedNewUpperBin: sourceReceipt.expectedNewUpperBin ?? null,
            tokenMetadata: sourceReceipt.tokenMetadata ?? null,
            phaseResults,
            recoverySource: recoverySourceFromReceipt(sourceReceipt),
            build: buildSummary,
            recovery: recoveryRequiredPlan({
              actionId: sourceReceipt.actionId,
              reason: errorMessage,
              expectedLowerBin: sourceReceipt.expectedNewLowerBin ?? sourceReceipt.proposedLowerBin ?? null,
              expectedUpperBin: sourceReceipt.expectedNewUpperBin ?? sourceReceipt.proposedUpperBin ?? null,
              tokenMetadata: sourceReceipt.tokenMetadata ?? null,
            }),
            error: errorMessage,
          };
    const persisted = receipt ? await persistKeeperExecutionReceipt(receipt) : null;

    return json(400, {
      ...(receipt || {}),
      ok: false,
      dryRun,
      submitted: false,
      status: receipt?.status || "Failed",
      error: errorMessage,
      receiptPath: persisted?.path,
      databasePersistence: persisted?.database,
    });
  }
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as KeeperPayload;
}

async function main() {
  const port = Number(process.env.RANGEGUARD_KEEPER_PORT || DEFAULT_PORT);
  const dryRun = process.env.RANGEGUARD_KEEPER_DRY_RUN !== "false";
  const keeper = keypairFromEnv("RANGEGUARD_KEEPER_KEYPAIR");
  const riskAuthority = keypairFromEnv("RANGEGUARD_RISK_AUTHORITY_KEYPAIR");
  const connection = new Connection(process.env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC, "confirmed");

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

      if (request.method === "GET" && (url.pathname === "/health" || url.searchParams.get("health") === "1")) {
        const ok = Boolean(keeper && riskAuthority && !keeper.publicKey.equals(riskAuthority.publicKey));
        const health = {
          ok,
          dryRun,
          partialFailureDrillEnabled: process.env.RANGEGUARD_PARTIAL_FAILURE_DRILL === "true",
          keeper: keeper?.publicKey.toBase58() || null,
          riskAuthority: riskAuthority?.publicKey.toBase58() || null,
          rpc: process.env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC,
          detail: ok ? "keeper ready" : "keeper and independent risk authority keypairs are required",
        };
        const result = json(ok ? 200 : 503, health);
        response.writeHead(result.statusCode, { "Content-Type": "application/json" });
        response.end(result.body);
        return;
      }

      if (request.method !== "POST") {
        const result = json(405, { ok: false, error: "Method not allowed" });
        response.writeHead(result.statusCode, { "Content-Type": "application/json" });
        response.end(result.body);
        return;
      }

      if (!keeper || !riskAuthority) {
        const result = json(503, { ok: false, error: "Keeper and risk authority keypairs are required." });
        response.writeHead(result.statusCode, { "Content-Type": "application/json" });
        response.end(result.body);
        return;
      }

      const payload = await readBody(request);
      if (payload.requestType === "MeteoraFullRebalance") {
        const result = await executeLiveFullRebalance(payload, keeper, riskAuthority, connection, dryRun);
        response.writeHead(result.statusCode, { "Content-Type": "application/json" });
        response.end(result.body);
        return;
      }

      if (payload.requestType === "MeteoraRebalanceRecovery") {
        const result = await executeRecoveryRequest(payload, keeper, riskAuthority, connection, dryRun);
        response.writeHead(result.statusCode, { "Content-Type": "application/json" });
        response.end(result.body);
        return;
      }

      const guard = assertPayload(payload, keeper, riskAuthority);
      const extraDryRunSigners = additionalSignerKeypairs(payload, dryRun);
      assertTargetInstructionPayload(payload, keeper, extraDryRunSigners);
      const targetInstructions = buildTargetInstructions(payload);

      if (targetInstructions.length === 0) {
        const result = json(dryRun ? 202 : 400, {
          ok: dryRun,
          dryRun,
          submitted: false,
          actionId: payload.action?.id,
          actionHash: payload.action?.actionHash,
          status: dryRun ? "AcceptedDryRun" : "TargetInstructionsRequired",
          detail:
            "Guard payload verified. Real devnet submission requires reviewed targetInstructions from DLMM/Jupiter builders.",
        });
        response.writeHead(result.statusCode, { "Content-Type": "application/json" });
        response.end(result.body);
        return;
      }

      const tx = new Transaction();
      tx.feePayer = keeper.publicKey;
      tx.add(
        new TransactionInstruction({
          programId: guard.guardProgramId,
          keys: guard.accounts.map(accountMeta),
          data: guard.guardData,
        }),
        ...targetInstructions,
      );
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(keeper, riskAuthority, ...extraDryRunSigners);

      const simulation = await connection.simulateTransaction(tx);
      if (simulation.value.err) {
        const result = json(409, {
          ok: false,
          submitted: false,
          status: "SimulationFailed",
          simulation: simulation.value,
        });
        response.writeHead(result.statusCode, { "Content-Type": "application/json" });
        response.end(result.body);
        return;
      }

      if (dryRun) {
        const result = json(202, {
          ok: true,
          dryRun,
          submitted: false,
          status: "Simulated",
          simulation: simulation.value,
        });
        response.writeHead(result.statusCode, { "Content-Type": "application/json" });
        response.end(result.body);
        return;
      }

      const signature = await sendAndConfirmRawTransaction(connection, tx.serialize(), {
        commitment: "confirmed",
      });
      const result = json(202, {
        ok: true,
        dryRun,
        submitted: true,
        status: "Submitted",
        signature,
      });
      response.writeHead(result.statusCode, { "Content-Type": "application/json" });
      response.end(result.body);
    } catch (error) {
      const result = json(400, {
        ok: false,
        error: error instanceof Error ? error.message : "Keeper request failed.",
      });
      response.writeHead(result.statusCode, { "Content-Type": "application/json" });
      response.end(result.body);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[RangeGuard Keeper] listening on http://127.0.0.1:${port}/rangeguard/submit`);
    console.log(`[RangeGuard Keeper] dryRun=${dryRun}`);
    console.log(`[RangeGuard Keeper] keeper=${keeper?.publicKey.toBase58() || "missing"}`);
    console.log(`[RangeGuard Keeper] riskAuthority=${riskAuthority?.publicKey.toBase58() || "missing"}`);
  });
}

main().catch((error) => {
  console.error("[RangeGuard Keeper] failed to start");
  console.error(error);
  process.exitCode = 1;
});
