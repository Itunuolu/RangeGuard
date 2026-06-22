import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BN from "bn.js";
import DLMM, {
  ActivationType,
  LBCLMM_PROGRAM_IDS,
  StrategyType,
  deriveCustomizablePermissionlessLbPair,
} from "@meteora-ag/dlmm";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

import { attachGuardPlan } from "@/lib/autonomy/guardProgram";
import type { BotAction, BotPolicy, Position } from "@/lib/types";

const DEFAULT_RPC = "https://api.devnet.solana.com";
const DLMM_PROGRAM_ID = new PublicKey(LBCLMM_PROGRAM_IDS.devnet);
const TOKEN_DECIMALS = 6;
const TOKEN_UNIT = 10 ** TOKEN_DECIMALS;
const BIN_STEP = 25;
const FEE_BPS = 25;
const ACTIVE_BIN = DLMM.getBinIdFromPrice("1", BIN_STEP, false);
const LOWER_BIN = ACTIVE_BIN - 10;
const UPPER_BIN = ACTIVE_BIN + 10;
const PROOF_PATH = ".rangeguard/devnet/meteora-proof.json";
const FULL_REBALANCE_MIN_KEEPER_SOL = 0.08;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function keypair(path: string) {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

async function sendTx(connection: Connection, transaction: Transaction, signers: Keypair[], label: string) {
  const signature = await sendAndConfirmTransaction(connection, transaction, signers, {
    commitment: "confirmed",
    skipPreflight: false,
  });
  console.log(`[Meteora Devnet Proof] ${label}: ${signature}`);
  return signature;
}

function secretKeyBase64(keypair: Keypair) {
  return Buffer.from(keypair.secretKey).toString("base64");
}

async function maybeTopUpKeeper(connection: Connection, owner: Keypair, keeper: Keypair) {
  const keeperBalance = await connection.getBalance(keeper.publicKey);
  const minimum = FULL_REBALANCE_MIN_KEEPER_SOL * LAMPORTS_PER_SOL;

  if (keeperBalance >= minimum) return null;

  const topUpLamports = Math.ceil(minimum - keeperBalance);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: keeper.publicKey,
      lamports: topUpLamports,
    }),
  );

  return sendTx(connection, tx, [owner], `top up keeper by ${topUpLamports / LAMPORTS_PER_SOL} SOL`);
}

async function submitDryRunPhase({
  policy,
  baseAction,
  phase,
  additionalSigner,
}: {
  policy: BotPolicy;
  baseAction: BotAction;
  phase: {
    id: string;
    label: string;
    detail: string;
    targetInstructions: NonNullable<BotAction["transactionPlan"]["targetInstructions"]>;
    targetInstructionDigest: string;
    targetProgramIds: string[];
    additionalSignerPublicKeys: string[];
    transactionCount: number;
    instructionCount: number;
    requiredSigners: string[];
  };
  additionalSigner?: Keypair;
}) {
  const action = attachGuardPlan(policy, {
    ...baseAction,
    id: `${baseAction.id}-${phase.id}`,
    title: phase.label,
    transactionPlan: {
      ...baseAction.transactionPlan,
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
  const response = await fetch(required("AUTONOMY_KEEPER_SIGNER_URL"), {
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
        id: action.id,
        type: action.type,
        actionHash: action.transactionPlan.actionHash,
        targetInstructionDigest: action.transactionPlan.targetInstructionDigest,
        notionalUsd: action.notionalUsd,
        estimatedSlippageBps: action.estimatedSlippageBps,
        proposedLowerBin: action.proposedLowerBin,
        proposedUpperBin: action.proposedUpperBin,
      },
      guardInstruction: {
        dataBase64: action.transactionPlan.guardInstructionBase64,
        accounts: action.transactionPlan.guardAccounts,
      },
      targetProgramIds: action.transactionPlan.targetProgramIds,
      targetInstructions: action.transactionPlan.targetInstructions,
      dryRunAdditionalSigners:
        additionalSigner && phase.additionalSignerPublicKeys.includes(additionalSigner.publicKey.toBase58())
          ? [
              {
                publicKey: additionalSigner.publicKey.toBase58(),
                secretKeyBase64: secretKeyBase64(additionalSigner),
                purpose: "MeteoraNewPosition",
              },
            ]
          : [],
      transactionSteps: action.transactionPlan.steps,
    }),
  });
  const body = await response.json().catch(() => null);

  return {
    phaseId: phase.id,
    ok: response.ok,
    status: body?.status || `HTTP ${response.status}`,
    submitted: Boolean(body?.submitted),
    response: body,
  };
}

async function submitLiveFullRebalance({
  policy,
  action,
}: {
  policy: BotPolicy;
  action: BotAction;
}) {
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
      },
      transactionSteps: [
        "Keeper generates the new Meteora position signer internally",
        "Keeper broadcasts remove/claim/close",
        "Keeper broadcasts initialize/add-liquidity",
        "Keeper verifies the old position closed and the new position range/owner",
      ],
    }),
  });
  const body = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: body?.status || `HTTP ${response.status}`,
    submitted: Boolean(body?.submitted),
    response: body,
  };
}

function basePolicy(): BotPolicy {
  const now = new Date().toISOString();

  return {
    id: "devnet-meteora-proof-policy",
    userId: "devnet-meteora-proof",
    name: "Devnet Meteora Proof Policy",
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

function proofPosition(poolAddress: PublicKey, positionAddress: PublicKey, activeBin: number): Position {
  const now = new Date().toISOString();

  return {
    id: "devnet-meteora-proof-position",
    userId: "devnet-meteora-proof",
    strategyId: null,
    poolId: "devnet-meteora-proof-pool",
    positionAddress: positionAddress.toBase58(),
    entryValueUsd: 2,
    currentValueUsd: 2,
    estimatedPnlUsd: 0,
    estimatedPnlPct: 0,
    feesEarnedUsd: 0.01,
    lowerBin: LOWER_BIN,
    upperBin: UPPER_BIN,
    activeBinAtEntry: activeBin,
    currentActiveBin: activeBin,
    healthStatus: "In range",
    healthScore: 92,
    suggestedAction: "Claim fees",
    status: "Open",
    openedAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    pool: {
      id: "devnet-meteora-proof-pool",
      poolAddress: poolAddress.toBase58(),
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

function actionForPosition(position: Position, type: "ClaimFees" | "Rebalance"): BotAction {
  const now = new Date().toISOString();

  return {
    id: `devnet-meteora-proof-${type.toLowerCase()}`,
    userId: "devnet-meteora-proof",
    policyId: "devnet-meteora-proof-policy",
    runId: "devnet-meteora-proof-run",
    positionId: position.id,
    type,
    status: "Queued",
    priority: type === "Rebalance" ? "High" : "Medium",
    protocol: "Meteora DLMM",
    title: `${type} proof for RGX/RGY`,
    reason: "Real devnet Meteora position controlled by the delegated keeper.",
    notionalUsd: type === "ClaimFees" ? 0.01 : 2,
    estimatedFeeUsd: 0.002,
    estimatedSlippageBps: type === "Rebalance" ? 25 : 0,
    proposedLowerBin: type === "Rebalance" && position.currentActiveBin !== null ? position.currentActiveBin - 8 : null,
    proposedUpperBin: type === "Rebalance" && position.currentActiveBin !== null ? position.currentActiveBin + 8 : null,
    simulationStatus: "Passed",
    executionStatus: "Ready",
    guardrailResults: [
      {
        id: "devnet-proof",
        label: "Devnet proof guardrail",
        passed: true,
        detail: "Purpose-built devnet test action.",
      },
    ],
    transactionPlan: {
      steps:
        type === "ClaimFees"
          ? ["Build real Meteora claim-fees transaction", "Submit through guard keeper dry-run"]
          : ["Build real Meteora remove/claim/close transaction", "Submit through guard keeper dry-run"],
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

async function main() {
  process.env.MOCK_MODE = "false";
  process.env.NEXT_PUBLIC_MOCK_MODE = "false";

  const connection = new Connection(process.env.SOLANA_RPC_URL || DEFAULT_RPC, "confirmed");
  const owner = keypair(required("RANGEGUARD_POLICY_OWNER_KEYPAIR"));
  const keeper = keypair(required("RANGEGUARD_KEEPER_KEYPAIR"));
  const ownerBalance = await connection.getBalance(owner.publicKey);
  const keeperBalance = await connection.getBalance(keeper.publicKey);

  console.log(`[Meteora Devnet Proof] owner=${owner.publicKey.toBase58()} balance=${ownerBalance / LAMPORTS_PER_SOL}`);
  console.log(`[Meteora Devnet Proof] keeper=${keeper.publicKey.toBase58()} balance=${keeperBalance / LAMPORTS_PER_SOL}`);
  const keeperTopUpSignature = await maybeTopUpKeeper(connection, owner, keeper);

  const existingTokenX = process.env.METEORA_PROOF_TOKEN_X ? new PublicKey(process.env.METEORA_PROOF_TOKEN_X) : null;
  const existingTokenY = process.env.METEORA_PROOF_TOKEN_Y ? new PublicKey(process.env.METEORA_PROOF_TOKEN_Y) : null;
  const existingPool = process.env.METEORA_PROOF_POOL ? new PublicKey(process.env.METEORA_PROOF_POOL) : null;
  const existingPosition = process.env.METEORA_PROOF_POSITION
    ? new PublicKey(process.env.METEORA_PROOF_POSITION)
    : null;
  const tokenX = existingTokenX || (await createMint(connection, owner, owner.publicKey, null, TOKEN_DECIMALS));
  const tokenY = existingTokenY || (await createMint(connection, owner, owner.publicKey, null, TOKEN_DECIMALS));
  console.log(`[Meteora Devnet Proof] tokenX=${tokenX.toBase58()}`);
  console.log(`[Meteora Devnet Proof] tokenY=${tokenY.toBase58()}`);

  let createPoolSignature = "existing";
  if (!existingTokenX || !existingTokenY) {
    const keeperTokenX = await getOrCreateAssociatedTokenAccount(connection, owner, tokenX, keeper.publicKey);
    const keeperTokenY = await getOrCreateAssociatedTokenAccount(connection, owner, tokenY, keeper.publicKey);
    const ownerTokenX = await getOrCreateAssociatedTokenAccount(connection, owner, tokenX, owner.publicKey);
    const ownerTokenY = await getOrCreateAssociatedTokenAccount(connection, owner, tokenY, owner.publicKey);
    await mintTo(connection, owner, tokenX, keeperTokenX.address, owner, BigInt(10) * BigInt(TOKEN_UNIT));
    await mintTo(connection, owner, tokenY, keeperTokenY.address, owner, BigInt(10) * BigInt(TOKEN_UNIT));
    await mintTo(connection, owner, tokenX, ownerTokenX.address, owner, BigInt(5) * BigInt(TOKEN_UNIT));
    await mintTo(connection, owner, tokenY, ownerTokenY.address, owner, BigInt(5) * BigInt(TOKEN_UNIT));
  }

  const [derivedPoolAddress] = deriveCustomizablePermissionlessLbPair(tokenX, tokenY, DLMM_PROGRAM_ID);
  const poolAddress = existingPool || derivedPoolAddress;

  if (!existingPool) {
    const createPoolTx = await DLMM.createCustomizablePermissionlessLbPair(
      connection,
      new BN(BIN_STEP),
      tokenX,
      tokenY,
      new BN(ACTIVE_BIN),
      new BN(FEE_BPS),
      ActivationType.Timestamp,
      false,
      owner.publicKey,
      undefined,
      false,
      undefined,
      undefined,
      { cluster: "devnet" },
    );
    createPoolSignature = await sendTx(connection, createPoolTx, [owner], "create DLMM pool");
  } else {
    console.log(`[Meteora Devnet Proof] reusing pool=${poolAddress.toBase58()}`);
  }

  const dlmmPool = await DLMM.create(connection, poolAddress, { cluster: "devnet" });
  const position = existingPosition ? null : Keypair.generate();
  let addLiquiditySignature = "existing";
  let swapSignature = "existing";
  const positionAddress = existingPosition || position?.publicKey;
  if (!positionAddress) throw new Error("A position address could not be resolved.");

  if (!existingPosition && position) {
    const addLiquidityTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: position.publicKey,
      totalXAmount: new BN(1 * TOKEN_UNIT),
      totalYAmount: new BN(1 * TOKEN_UNIT),
      strategy: {
        minBinId: LOWER_BIN,
        maxBinId: UPPER_BIN,
        strategyType: StrategyType.Spot,
      },
      user: keeper.publicKey,
      slippage: 0.5,
    });
    addLiquiditySignature = await sendTx(connection, addLiquidityTx, [keeper, position], "open keeper-owned position");

    const swapBinArrays = await dlmmPool.getBinArrayForSwap(true);
    const swapQuote = dlmmPool.swapQuote(new BN(100_000), true, new BN(100), swapBinArrays, true);
    const swapTx = await dlmmPool.swap({
      inToken: tokenX,
      outToken: tokenY,
      inAmount: new BN(100_000),
      minOutAmount: swapQuote.minOutAmount,
      lbPair: poolAddress,
      user: owner.publicKey,
      binArraysPubkey: swapQuote.binArraysPubkey,
    });
    swapSignature = await sendTx(connection, swapTx, [owner], "swap to generate fees");
  } else {
    console.log(`[Meteora Devnet Proof] reusing position=${positionAddress.toBase58()}`);
  }

  const refreshedPool = await DLMM.create(connection, poolAddress, { cluster: "devnet" });
  const lbPosition = await refreshedPool.getPosition(positionAddress);
  const rangeGuardPosition = proofPosition(poolAddress, positionAddress, refreshedPool.lbPair.activeId);
  const policy = basePolicy();
  const claimAction = actionForPosition(rangeGuardPosition, "ClaimFees");
  const rebalanceAction = actionForPosition(rangeGuardPosition, "Rebalance");
  const liveFullRebalanceEnabled = process.env.AUTONOMY_DEVNET_LIVE_REBALANCE === "true";
  const { buildMeteoraDlmmTargetInstructions } = await import("@/lib/autonomy/meteoraTransactionBuilder");
  const { buildMeteoraDlmmFullRebalanceDryRun } = await import("@/lib/autonomy/meteoraTransactionBuilder");
  const { submitGuardedAutonomyAction } = await import("@/lib/autonomy/executor");
  const claimBuild = await buildMeteoraDlmmTargetInstructions({ policy, action: claimAction });
  const rebalanceBuild = await buildMeteoraDlmmTargetInstructions({ policy, action: rebalanceAction });
  const fullRebalanceNewPosition = Keypair.generate();
  const fullRebalanceBuild = await buildMeteoraDlmmFullRebalanceDryRun({
    policy,
    action: rebalanceAction,
    newPositionAddress: fullRebalanceNewPosition.publicKey,
  });

  console.log(
    `[Meteora Devnet Proof] claim builder status=${claimBuild.status} instructions=${claimBuild.instructionCount} digest=${claimBuild.targetInstructionDigest}`,
  );
  console.log(
    `[Meteora Devnet Proof] rebalance builder status=${rebalanceBuild.status} instructions=${rebalanceBuild.instructionCount} digest=${rebalanceBuild.targetInstructionDigest}`,
  );
  console.log(
    `[Meteora Devnet Proof] full rebalance dry-run status=${fullRebalanceBuild.status} phases=${fullRebalanceBuild.phases.length} newPosition=${fullRebalanceBuild.newPositionAddress}`,
  );

  const claimSubmit = !liveFullRebalanceEnabled && claimBuild.status === "Built"
    ? await submitGuardedAutonomyAction(policy, claimAction)
    : null;
  const rebalanceSubmit = !liveFullRebalanceEnabled && rebalanceBuild.status === "Built"
    ? await submitGuardedAutonomyAction(policy, rebalanceAction)
    : null;
  const fullRebalancePhaseSubmits =
    !liveFullRebalanceEnabled && fullRebalanceBuild.status === "Built"
      ? await Promise.all(
          fullRebalanceBuild.phases.map((phase) =>
            submitDryRunPhase({
              policy,
              baseAction: rebalanceAction,
              phase,
              additionalSigner: fullRebalanceNewPosition,
            }),
          ),
        )
      : [];
  const liveFullRebalanceSubmit =
    liveFullRebalanceEnabled && fullRebalanceBuild.status === "Built"
      ? await submitLiveFullRebalance({ policy, action: rebalanceAction })
      : null;

  if (claimSubmit) {
    console.log(`[Meteora Devnet Proof] claim guarded submit status=${claimSubmit.status} submitted=${claimSubmit.submitted}`);
  }
  if (rebalanceSubmit) {
    console.log(
      `[Meteora Devnet Proof] rebalance guarded submit status=${rebalanceSubmit.status} submitted=${rebalanceSubmit.submitted}`,
    );
  }
  for (const phaseSubmit of fullRebalancePhaseSubmits) {
    console.log(
      `[Meteora Devnet Proof] full rebalance phase=${phaseSubmit.phaseId} status=${phaseSubmit.status} submitted=${phaseSubmit.submitted}`,
    );
  }
  if (liveFullRebalanceSubmit) {
    console.log(
      `[Meteora Devnet Proof] live full rebalance status=${liveFullRebalanceSubmit.status} submitted=${liveFullRebalanceSubmit.submitted}`,
    );
  }

  const proof = {
    createdAt: new Date().toISOString(),
    rpc: process.env.SOLANA_RPC_URL || DEFAULT_RPC,
    owner: owner.publicKey.toBase58(),
    keeper: keeper.publicKey.toBase58(),
    tokenX: tokenX.toBase58(),
    tokenY: tokenY.toBase58(),
    poolAddress: poolAddress.toBase58(),
    positionAddress: positionAddress.toBase58(),
    activeBin: refreshedPool.lbPair.activeId,
    lowerBin: lbPosition.positionData.lowerBinId,
    upperBin: lbPosition.positionData.upperBinId,
    positionOwner: lbPosition.positionData.owner.toBase58(),
    signatures: {
      createPool: createPoolSignature,
      addLiquidity: addLiquiditySignature,
      swap: swapSignature,
      keeperTopUp: keeperTopUpSignature,
    },
    claimBuild,
    rebalanceBuild,
    fullRebalanceBuild,
    claimSubmit,
    rebalanceSubmit,
    fullRebalancePhaseSubmits,
    liveFullRebalanceSubmit,
  };

  mkdirSync(dirname(resolve(PROOF_PATH)), { recursive: true });
  writeFileSync(PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(`[Meteora Devnet Proof] wrote ${PROOF_PATH}`);
}

main().catch((error) => {
  console.error("[Meteora Devnet Proof] failed");
  console.error(error);
  process.exitCode = 1;
});
