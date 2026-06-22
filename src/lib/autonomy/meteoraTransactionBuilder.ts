import BN from "bn.js";
import DLMM, { StrategyType, type LbPosition } from "@meteora-ag/dlmm";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID as SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";

import { sha256Hex } from "@/lib/autonomy/actionHash";
import { parsePublicKey } from "@/lib/autonomy/programs";
import { serverConfig } from "@/lib/config";
import type { BotAction, BotPolicy, KeeperExecutionReceipt, KeeperReceiptTokenMetadata } from "@/lib/types";

const ASSOCIATED_TOKEN_PROGRAM_ID = SPL_ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const CREATE_IDEMPOTENT_ATA_DATA_BASE64 = "AQ==";

export type TargetInstructionPayload = NonNullable<BotAction["transactionPlan"]["targetInstructions"]>[number];

export type MeteoraRebalancePhaseId =
  | "remove-old-position"
  | "add-new-position"
  | "retry-add-liquidity"
  | "withdraw-to-owner";

export type MeteoraTargetBuildResult = {
  source: "Meteora DLMM";
  status: "Built" | "Skipped" | "NeedsWalletSignature" | "Unsupported" | "Failed";
  detail: string;
  targetInstructions: TargetInstructionPayload[];
  targetInstructionDigest: string | null;
  targetProgramIds: string[];
  requiredSigners: string[];
  transactionCount: number;
  instructionCount: number;
};

export type FullRebalanceDryRunPhase = {
  id: MeteoraRebalancePhaseId;
  label: string;
  detail: string;
  targetInstructions: TargetInstructionPayload[];
  targetInstructionDigest: string;
  targetProgramIds: string[];
  requiredSigners: string[];
  additionalSignerPublicKeys: string[];
  transactionCount: number;
  instructionCount: number;
};

export type FullRebalanceDryRunBuildResult = {
  source: "Meteora DLMM";
  status: "Built" | "Skipped" | "NeedsWalletSignature" | "Unsupported" | "Failed";
  detail: string;
  oldPositionAddress: string | null;
  newPositionAddress: string | null;
  expectedNewLowerBin: number | null;
  expectedNewUpperBin: number | null;
  estimatedDepositXAmount: string | null;
  estimatedDepositYAmount: string | null;
  tokenMetadata?: KeeperReceiptTokenMetadata | null;
  phases: FullRebalanceDryRunPhase[];
};

type BuildTargetInput = {
  policy: BotPolicy;
  action: BotAction;
  ownerAddress?: string | null;
};

type BuildFullRebalanceDryRunInput = BuildTargetInput & {
  newPositionAddress: PublicKey;
};

type BuildRecoveryAddLiquidityInput = {
  policy: BotPolicy;
  receipt: KeeperExecutionReceipt;
  ownerAddress?: string | null;
  newPositionAddress: PublicKey;
};

type WithdrawTokenTransfer = {
  mint: string;
  amount: string;
  tokenProgramId?: string | null;
};

type BuildWithdrawToOwnerInput = {
  policy: BotPolicy;
  receipt: KeeperExecutionReceipt;
  ownerAddress: string;
  tokenTransfers: WithdrawTokenTransfer[];
};

function emptyResult(
  status: MeteoraTargetBuildResult["status"],
  detail: string,
  overrides: Partial<MeteoraTargetBuildResult> = {},
): MeteoraTargetBuildResult {
  return {
    source: "Meteora DLMM",
    status,
    detail,
    targetInstructions: [],
    targetInstructionDigest: null,
    targetProgramIds: [],
    requiredSigners: [],
    transactionCount: 0,
    instructionCount: 0,
    ...overrides,
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function instructionToPayload(instruction: TransactionInstruction): TargetInstructionPayload {
  return {
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    dataBase64: Buffer.from(instruction.data).toString("base64"),
  };
}

function normalizeTransactions(value: Transaction | Transaction[]) {
  return Array.isArray(value) ? value : [value];
}

function transactionsToTargetInstructions(transactions: Transaction[]) {
  return transactions.flatMap((transaction) => transaction.instructions.map(instructionToPayload));
}

function compactDuplicateIdempotentAtaInstructions(instructions: TargetInstructionPayload[]) {
  const seen = new Set<string>();

  return instructions.filter((instruction) => {
    if (
      instruction.programId !== ASSOCIATED_TOKEN_PROGRAM_ID ||
      instruction.dataBase64 !== CREATE_IDEMPOTENT_ATA_DATA_BASE64
    ) {
      return true;
    }

    const key = JSON.stringify(instruction);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function digestTargetInstructions(instructions: TargetInstructionPayload[]) {
  return sha256Hex(
    instructions.map((instruction) => ({
      programId: instruction.programId,
      keys: instruction.keys.map((key) => ({
        pubkey: key.pubkey,
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
      dataBase64: instruction.dataBase64,
    })),
  );
}

export function targetProgramIdsFromInstructions(instructions: TargetInstructionPayload[]) {
  return unique(instructions.map((instruction) => instruction.programId));
}

export function requiredSignersFromInstructions(instructions: TargetInstructionPayload[]) {
  return unique(
    instructions.flatMap((instruction) => instruction.keys.filter((key) => key.isSigner).map((key) => key.pubkey)),
  );
}

export function canKeeperSignTargetInstructions(requiredSigners: string[], delegatedAuthority: string | null | undefined) {
  return Boolean(delegatedAuthority) && requiredSigners.every((signer) => signer === delegatedAuthority);
}

function positionBinRange(position: LbPosition, fallbackLowerBin: number, fallbackUpperBin: number) {
  const lowerBinId = Number.isFinite(position.positionData.lowerBinId)
    ? position.positionData.lowerBinId
    : fallbackLowerBin;
  const upperBinId = Number.isFinite(position.positionData.upperBinId)
    ? position.positionData.upperBinId
    : fallbackUpperBin;

  return {
    fromBinId: Math.min(lowerBinId, upperBinId),
    toBinId: Math.max(lowerBinId, upperBinId),
  };
}

function plannedRebalanceRange(action: BotAction, currentActiveBin: number) {
  return {
    minBinId: action.proposedLowerBin ?? currentActiveBin - 8,
    maxBinId: action.proposedUpperBin ?? currentActiveBin + 8,
  };
}

function parsePositiveAmount(value: string) {
  const amount = new BN(value || "0");
  return amount.isZero() ? new BN(1) : amount;
}

function publicKeyString(value: unknown) {
  if (typeof value === "string") {
    try {
      return new PublicKey(value).toBase58();
    } catch {
      return null;
    }
  }

  if (value && typeof value === "object") {
    const candidate = value as { toBase58?: () => string };
    if (typeof candidate.toBase58 !== "function") return null;

    try {
      return candidate.toBase58();
    } catch {
      return null;
    }
  }

  return null;
}

function publicKeyFromUnknown(value: unknown) {
  const key = publicKeyString(value);
  return key ? new PublicKey(key) : null;
}

function tokenMetadataFromDlmmPool({
  dlmmPool,
  keeper,
  amountX,
  amountY,
}: {
  dlmmPool: { lbPair: unknown };
  keeper: PublicKey;
  amountX: string | null;
  amountY: string | null;
}): KeeperReceiptTokenMetadata | null {
  const pair = dlmmPool.lbPair && typeof dlmmPool.lbPair === "object" ? (dlmmPool.lbPair as Record<string, unknown>) : {};
  const tokenXMint = publicKeyString(pair.tokenXMint) || publicKeyString(pair.tokenXMintPubkey);
  const tokenYMint = publicKeyString(pair.tokenYMint) || publicKeyString(pair.tokenYMintPubkey);
  const tokenXProgram =
    publicKeyFromUnknown(pair.tokenXProgramId) || publicKeyFromUnknown(pair.tokenXProgram) || TOKEN_PROGRAM_ID;
  const tokenYProgram =
    publicKeyFromUnknown(pair.tokenYProgramId) || publicKeyFromUnknown(pair.tokenYProgram) || TOKEN_PROGRAM_ID;
  const keeperTokenXAccount = tokenXMint
    ? getAssociatedTokenAddressSync(
        new PublicKey(tokenXMint),
        keeper,
        true,
        tokenXProgram,
        SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      ).toBase58()
    : null;
  const keeperTokenYAccount = tokenYMint
    ? getAssociatedTokenAddressSync(
        new PublicKey(tokenYMint),
        keeper,
        true,
        tokenYProgram,
        SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      ).toBase58()
    : null;

  if (!tokenXMint && !tokenYMint) return null;

  const transfers: KeeperReceiptTokenMetadata["transfers"] = [];

  if (tokenXMint && amountX && amountX !== "0") {
    transfers.push({
      side: "X",
      mint: tokenXMint,
      amount: amountX,
      keeperTokenAccount: keeperTokenXAccount,
      tokenProgramId: tokenXProgram.toBase58(),
    });
  }

  if (tokenYMint && amountY && amountY !== "0") {
    transfers.push({
      side: "Y",
      mint: tokenYMint,
      amount: amountY,
      keeperTokenAccount: keeperTokenYAccount,
      tokenProgramId: tokenYProgram.toBase58(),
    });
  }

  return {
    source: "MeteoraDLMM",
    tokenXMint,
    tokenYMint,
    keeperTokenXAccount,
    keeperTokenYAccount,
    tokenXProgramId: tokenXProgram.toBase58(),
    tokenYProgramId: tokenYProgram.toBase58(),
    amountX,
    amountY,
    capturedAt: new Date().toISOString(),
    transfers,
  };
}

function phaseFromTransactions({
  id,
  label,
  detail,
  transactions,
  additionalSignerPublicKeys = [],
  dropComputeBudget = false,
}: {
  id: FullRebalanceDryRunPhase["id"];
  label: string;
  detail: string;
  transactions: Transaction[];
  additionalSignerPublicKeys?: string[];
  dropComputeBudget?: boolean;
}): FullRebalanceDryRunPhase {
  const rawInstructions = transactionsToTargetInstructions(transactions);
  const targetInstructions = compactDuplicateIdempotentAtaInstructions(
    dropComputeBudget
      ? rawInstructions.filter((instruction) => instruction.programId !== COMPUTE_BUDGET_PROGRAM_ID)
      : rawInstructions,
  );

  return {
    id,
    label,
    detail,
    targetInstructions,
    targetInstructionDigest: digestTargetInstructions(targetInstructions),
    targetProgramIds: targetProgramIdsFromInstructions(targetInstructions),
    requiredSigners: requiredSignersFromInstructions(targetInstructions),
    additionalSignerPublicKeys,
    transactionCount: transactions.length,
    instructionCount: targetInstructions.length,
  };
}

function ownerMismatchResult(owner: PublicKey, position: LbPosition) {
  const positionOwner = position.positionData.owner.toBase58();

  if (positionOwner === owner.toBase58()) return null;

  return emptyResult(
    "NeedsWalletSignature",
    `Meteora position owner is ${positionOwner}. The configured delegated authority ${owner.toBase58()} cannot sign for this position.`,
    {
      requiredSigners: [positionOwner],
    },
  );
}

export async function buildMeteoraDlmmTargetInstructions({
  policy,
  action,
  ownerAddress,
}: BuildTargetInput): Promise<MeteoraTargetBuildResult> {
  if (action.protocol !== "Meteora DLMM") {
    return emptyResult("Unsupported", `Unsupported protocol: ${action.protocol}.`);
  }

  if (action.type !== "ClaimFees" && action.type !== "Rebalance") {
    return emptyResult(
      "Unsupported",
      `The first real Meteora builder supports claim fees and rebalance remove/claim/close legs only. Received ${action.type}.`,
    );
  }

  const position = action.position;
  if (!position) {
    return emptyResult("Skipped", "No position was attached to the bot action.");
  }

  const poolAddress = parsePublicKey(position.pool.poolAddress);
  const positionAddress = parsePublicKey(position.positionAddress);
  const delegatedAuthority = parsePublicKey(policy.delegatedAuthority);
  const requestedOwner = parsePublicKey(ownerAddress) || delegatedAuthority;

  if (!poolAddress || !positionAddress) {
    return emptyResult(
      "Skipped",
      "Pool or position address is not a valid Solana public key. This is expected for mock RangeGuard positions.",
    );
  }

  if (!delegatedAuthority || !requestedOwner) {
    return emptyResult("NeedsWalletSignature", "A delegated authority or connected owner wallet is required.");
  }

  if (!requestedOwner.equals(delegatedAuthority)) {
    return emptyResult(
      "NeedsWalletSignature",
      `Connected owner ${requestedOwner.toBase58()} is not the delegated keeper authority ${delegatedAuthority.toBase58()}. Build this as a wallet-signed transaction instead of an autonomous keeper transaction.`,
      { requiredSigners: [requestedOwner.toBase58()] },
    );
  }

  try {
    const connection = new Connection(serverConfig.solanaRpcUrl, "confirmed");
    const dlmmPool = await DLMM.create(connection, poolAddress);
    const lbPosition = await dlmmPool.getPosition(positionAddress);
    const ownerMismatch = ownerMismatchResult(requestedOwner, lbPosition);

    if (ownerMismatch) return ownerMismatch;

    const transactions =
      action.type === "ClaimFees"
        ? normalizeTransactions(await dlmmPool.claimSwapFee({ owner: requestedOwner, position: lbPosition }))
        : await dlmmPool.removeLiquidity({
            user: requestedOwner,
            position: positionAddress,
            ...positionBinRange(lbPosition, position.lowerBin, position.upperBin),
            bps: new BN(10_000),
            shouldClaimAndClose: true,
          });
    const targetInstructions = compactDuplicateIdempotentAtaInstructions(transactionsToTargetInstructions(transactions));
    const targetProgramIds = targetProgramIdsFromInstructions(targetInstructions);
    const requiredSigners = requiredSignersFromInstructions(targetInstructions);
    const canSign = canKeeperSignTargetInstructions(requiredSigners, delegatedAuthority.toBase58());

    if (!canSign) {
      return emptyResult(
        "NeedsWalletSignature",
        `The Meteora ${action.type} transaction requires signer(s) outside the delegated keeper authority: ${requiredSigners.join(", ")}.`,
        {
          targetProgramIds,
          requiredSigners,
          transactionCount: transactions.length,
          instructionCount: targetInstructions.length,
        },
      );
    }

    return {
      source: "Meteora DLMM",
      status: "Built",
      detail:
        action.type === "ClaimFees"
          ? "Built real Meteora DLMM claim-fees instructions for guarded keeper submission."
          : "Built the real Meteora DLMM remove-liquidity, claim, and close leg. The redeposit leg remains disabled until token amount and new-position signing review is complete.",
      targetInstructions,
      targetInstructionDigest: digestTargetInstructions(targetInstructions),
      targetProgramIds,
      requiredSigners,
      transactionCount: transactions.length,
      instructionCount: targetInstructions.length,
    };
  } catch (error) {
    return emptyResult("Failed", error instanceof Error ? error.message : "Failed to build Meteora DLMM instructions.");
  }
}

export async function buildMeteoraDlmmFullRebalanceDryRun({
  policy,
  action,
  ownerAddress,
  newPositionAddress,
}: BuildFullRebalanceDryRunInput): Promise<FullRebalanceDryRunBuildResult> {
  if (action.protocol !== "Meteora DLMM") {
    return {
      source: "Meteora DLMM",
      status: "Unsupported",
      detail: `Unsupported protocol: ${action.protocol}.`,
      oldPositionAddress: null,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: null,
      expectedNewUpperBin: null,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }

  if (action.type !== "Rebalance") {
    return {
      source: "Meteora DLMM",
      status: "Unsupported",
      detail: `Full rebalance dry-run only supports Rebalance actions. Received ${action.type}.`,
      oldPositionAddress: null,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: null,
      expectedNewUpperBin: null,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }

  const position = action.position;
  if (!position) {
    return {
      source: "Meteora DLMM",
      status: "Skipped",
      detail: "No position was attached to the bot action.",
      oldPositionAddress: null,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: null,
      expectedNewUpperBin: null,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }

  const poolAddress = parsePublicKey(position.pool.poolAddress);
  const positionAddress = parsePublicKey(position.positionAddress);
  const delegatedAuthority = parsePublicKey(policy.delegatedAuthority);
  const requestedOwner = parsePublicKey(ownerAddress) || delegatedAuthority;

  if (!poolAddress || !positionAddress) {
    return {
      source: "Meteora DLMM",
      status: "Skipped",
      detail: "Pool or position address is not a valid Solana public key.",
      oldPositionAddress: position.positionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: null,
      expectedNewUpperBin: null,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }

  if (!delegatedAuthority || !requestedOwner) {
    return {
      source: "Meteora DLMM",
      status: "NeedsWalletSignature",
      detail: "A delegated authority or connected owner wallet is required.",
      oldPositionAddress: positionAddress.toBase58(),
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: null,
      expectedNewUpperBin: null,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }

  if (!requestedOwner.equals(delegatedAuthority)) {
    return {
      source: "Meteora DLMM",
      status: "NeedsWalletSignature",
      detail: `Connected owner ${requestedOwner.toBase58()} is not the delegated keeper authority ${delegatedAuthority.toBase58()}.`,
      oldPositionAddress: positionAddress.toBase58(),
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: null,
      expectedNewUpperBin: null,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }

  try {
    const connection = new Connection(serverConfig.solanaRpcUrl, "confirmed");
    const dlmmPool = await DLMM.create(connection, poolAddress);
    const lbPosition = await dlmmPool.getPosition(positionAddress);
    const ownerMismatch = ownerMismatchResult(requestedOwner, lbPosition);

    if (ownerMismatch) {
      return {
        source: "Meteora DLMM",
        status: ownerMismatch.status,
        detail: ownerMismatch.detail,
        oldPositionAddress: positionAddress.toBase58(),
        newPositionAddress: newPositionAddress.toBase58(),
        expectedNewLowerBin: null,
        expectedNewUpperBin: null,
        estimatedDepositXAmount: null,
        estimatedDepositYAmount: null,
        phases: [],
      };
    }

    const removeTransactions = await dlmmPool.removeLiquidity({
      user: requestedOwner,
      position: positionAddress,
      ...positionBinRange(lbPosition, position.lowerBin, position.upperBin),
      bps: new BN(10_000),
      shouldClaimAndClose: true,
    });
    const depositXAmount = parsePositiveAmount(lbPosition.positionData.totalXAmount);
    const depositYAmount = parsePositiveAmount(lbPosition.positionData.totalYAmount);
    const tokenMetadata = tokenMetadataFromDlmmPool({
      dlmmPool,
      keeper: requestedOwner,
      amountX: depositXAmount.toString(),
      amountY: depositYAmount.toString(),
    });
    const currentActiveBin = position.currentActiveBin ?? dlmmPool.lbPair.activeId;
    const plannedRange = plannedRebalanceRange(action, currentActiveBin);
    const addLiquidityTransaction = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPositionAddress,
      totalXAmount: depositXAmount,
      totalYAmount: depositYAmount,
      strategy: {
        ...plannedRange,
        strategyType: StrategyType.Spot,
      },
      user: requestedOwner,
      slippage: Math.max(0.01, action.estimatedSlippageBps / 100),
    });

    const removePhase = phaseFromTransactions({
      id: "remove-old-position",
      label: "Remove, claim, and close old position",
      detail: "Builds the real Meteora remove-liquidity, fee-claim, and close-position leg for the existing position.",
      transactions: removeTransactions,
    });
    const addPhase = phaseFromTransactions({
      id: "add-new-position",
      label: "Open new position and add liquidity",
      detail:
        "Builds the real Meteora initialize-position and add-liquidity leg using an explicit ephemeral new-position signer.",
      transactions: normalizeTransactions(addLiquidityTransaction),
      additionalSignerPublicKeys: [newPositionAddress.toBase58()],
      dropComputeBudget: true,
    });
    const allowedSigners = new Set([delegatedAuthority.toBase58(), newPositionAddress.toBase58()]);
    const unsupportedSigners = [...removePhase.requiredSigners, ...addPhase.requiredSigners].filter(
      (signer) => !allowedSigners.has(signer),
    );

    if (unsupportedSigners.length > 0) {
      return {
        source: "Meteora DLMM",
        status: "NeedsWalletSignature",
        detail: `Full rebalance dry-run requires unsupported signer(s): ${unique(unsupportedSigners).join(", ")}.`,
        oldPositionAddress: positionAddress.toBase58(),
        newPositionAddress: newPositionAddress.toBase58(),
        expectedNewLowerBin: plannedRange.minBinId,
        expectedNewUpperBin: plannedRange.maxBinId,
        estimatedDepositXAmount: depositXAmount.toString(),
        estimatedDepositYAmount: depositYAmount.toString(),
        tokenMetadata,
        phases: [removePhase, addPhase],
      };
    }

    return {
      source: "Meteora DLMM",
      status: "Built",
      detail:
        "Built a phase-split full rebalance plan: remove/claim/close old position, then initialize/add liquidity into a new position. The new-position signer is explicit for dry-run and keeper-generated for live devnet execution.",
      oldPositionAddress: positionAddress.toBase58(),
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: plannedRange.minBinId,
      expectedNewUpperBin: plannedRange.maxBinId,
      estimatedDepositXAmount: depositXAmount.toString(),
      estimatedDepositYAmount: depositYAmount.toString(),
      tokenMetadata,
      phases: [removePhase, addPhase],
    };
  } catch (error) {
    return {
      source: "Meteora DLMM",
      status: "Failed",
      detail: error instanceof Error ? error.message : "Failed to build full Meteora DLMM rebalance dry-run.",
      oldPositionAddress: positionAddress.toBase58(),
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: null,
      expectedNewUpperBin: null,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }
}

export async function buildMeteoraDlmmRecoveryAddLiquidityPlan({
  policy,
  receipt,
  ownerAddress,
  newPositionAddress,
}: BuildRecoveryAddLiquidityInput): Promise<FullRebalanceDryRunBuildResult> {
  const poolAddress = parsePublicKey(receipt.poolAddress);
  const delegatedAuthority = parsePublicKey(policy.delegatedAuthority);
  const requestedOwner = parsePublicKey(ownerAddress) || delegatedAuthority;
  const expectedLowerBin = receipt.expectedNewLowerBin ?? receipt.proposedLowerBin ?? null;
  const expectedUpperBin = receipt.expectedNewUpperBin ?? receipt.proposedUpperBin ?? null;

  if (!poolAddress) {
    return {
      source: "Meteora DLMM",
      status: "Skipped",
      detail: "Recovery retry requires a valid DLMM pool address in the receipt.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
      estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
      phases: [],
    };
  }

  if (!delegatedAuthority || !requestedOwner) {
    return {
      source: "Meteora DLMM",
      status: "NeedsWalletSignature",
      detail: "Recovery retry requires the delegated keeper authority.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
      estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
      phases: [],
    };
  }

  if (!requestedOwner.equals(delegatedAuthority)) {
    return {
      source: "Meteora DLMM",
      status: "NeedsWalletSignature",
      detail: `Recovery retry must spend from keeper token accounts owned by ${delegatedAuthority.toBase58()}.`,
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
      estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
      phases: [],
    };
  }

  if (expectedLowerBin === null || expectedUpperBin === null) {
    return {
      source: "Meteora DLMM",
      status: "Skipped",
      detail: "Recovery retry requires the original expected lower and upper bins.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
      estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
      phases: [],
    };
  }

  if (receipt.estimatedDepositXAmount === null || receipt.estimatedDepositXAmount === undefined) {
    return {
      source: "Meteora DLMM",
      status: "Skipped",
      detail: "Recovery retry requires the original estimated token X amount.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
      estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
      phases: [],
    };
  }

  if (receipt.estimatedDepositYAmount === null || receipt.estimatedDepositYAmount === undefined) {
    return {
      source: "Meteora DLMM",
      status: "Skipped",
      detail: "Recovery retry requires the original estimated token Y amount.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
      estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
      phases: [],
    };
  }

  try {
    const connection = new Connection(serverConfig.solanaRpcUrl, "confirmed");
    const dlmmPool = await DLMM.create(connection, poolAddress);
    const addLiquidityTransaction = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPositionAddress,
      totalXAmount: parsePositiveAmount(receipt.estimatedDepositXAmount || "0"),
      totalYAmount: parsePositiveAmount(receipt.estimatedDepositYAmount || "0"),
      strategy: {
        minBinId: expectedLowerBin,
        maxBinId: expectedUpperBin,
        strategyType: StrategyType.Spot,
      },
      user: requestedOwner,
      slippage: Math.max(0.01, (receipt.estimatedSlippageBps ?? 0) / 100),
    });
    const retryPhase = phaseFromTransactions({
      id: "retry-add-liquidity",
      label: "Retry open position and add liquidity",
      detail:
        "Retries only the add-liquidity leg using the original planned range and a fresh keeper-generated new-position signer.",
      transactions: normalizeTransactions(addLiquidityTransaction),
      additionalSignerPublicKeys: [newPositionAddress.toBase58()],
      dropComputeBudget: true,
    });
    const allowedSigners = new Set([delegatedAuthority.toBase58(), newPositionAddress.toBase58()]);
    const unsupportedSigners = retryPhase.requiredSigners.filter((signer) => !allowedSigners.has(signer));

    if (unsupportedSigners.length > 0) {
      return {
        source: "Meteora DLMM",
        status: "NeedsWalletSignature",
        detail: `Recovery retry requires unsupported signer(s): ${unique(unsupportedSigners).join(", ")}.`,
        oldPositionAddress: receipt.oldPositionAddress,
        newPositionAddress: newPositionAddress.toBase58(),
        expectedNewLowerBin: expectedLowerBin,
        expectedNewUpperBin: expectedUpperBin,
        estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
        estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
        tokenMetadata: receipt.tokenMetadata ?? null,
        phases: [retryPhase],
      };
    }

    return {
      source: "Meteora DLMM",
      status: "Built",
      detail:
        "Built a guarded recovery retry plan that reuses the original range and spends only from keeper-owned token accounts.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
      estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
      tokenMetadata: receipt.tokenMetadata ?? null,
      phases: [retryPhase],
    };
  } catch (error) {
    return {
      source: "Meteora DLMM",
      status: "Failed",
      detail: error instanceof Error ? error.message : "Failed to build recovery add-liquidity plan.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: newPositionAddress.toBase58(),
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: receipt.estimatedDepositXAmount ?? null,
      estimatedDepositYAmount: receipt.estimatedDepositYAmount ?? null,
      phases: [],
    };
  }
}

export function buildGuardedWithdrawToOwnerPlan({
  policy,
  receipt,
  ownerAddress,
  tokenTransfers,
}: BuildWithdrawToOwnerInput): FullRebalanceDryRunBuildResult {
  const delegatedAuthority = parsePublicKey(policy.delegatedAuthority);
  const owner = parsePublicKey(ownerAddress);
  const expectedLowerBin = receipt.expectedNewLowerBin ?? receipt.proposedLowerBin ?? null;
  const expectedUpperBin = receipt.expectedNewUpperBin ?? receipt.proposedUpperBin ?? null;

  if (!delegatedAuthority || !owner) {
    return {
      source: "Meteora DLMM",
      status: "NeedsWalletSignature",
      detail: "Withdraw fallback requires a delegated keeper authority and a valid owner wallet.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: null,
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }

  if (tokenTransfers.length === 0) {
    return {
      source: "Meteora DLMM",
      status: "Skipped",
      detail: "Withdraw fallback requires explicit token mint and amount entries.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: null,
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }

  try {
    const transaction = new Transaction();

    for (const transfer of tokenTransfers) {
      const mint = parsePublicKey(transfer.mint);
      const tokenProgramId = parsePublicKey(transfer.tokenProgramId) || TOKEN_PROGRAM_ID;
      const amount = BigInt(transfer.amount);

      if (!mint) throw new Error(`Invalid token mint: ${transfer.mint}.`);
      if (amount <= BigInt(0)) throw new Error(`Withdraw amount must be positive for ${transfer.mint}.`);

      const sourceAta = getAssociatedTokenAddressSync(
        mint,
        delegatedAuthority,
        true,
        tokenProgramId,
        SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const destinationAta = getAssociatedTokenAddressSync(
        mint,
        owner,
        false,
        tokenProgramId,
        SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      transaction.add(
        createAssociatedTokenAccountIdempotentInstruction(
          delegatedAuthority,
          destinationAta,
          owner,
          mint,
          tokenProgramId,
          SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        createTransferInstruction(sourceAta, destinationAta, delegatedAuthority, amount, [], tokenProgramId),
      );
    }

    const withdrawPhase = phaseFromTransactions({
      id: "withdraw-to-owner",
      label: "Withdraw keeper token accounts to owner",
      detail:
        "Fallback recovery path: guarded SPL token transfers from keeper-owned token accounts back to the owner wallet.",
      transactions: [transaction],
    });

    return {
      source: "Meteora DLMM",
      status: "Built",
      detail:
        "Built a guarded withdraw-to-owner fallback. The guard policy must allow the SPL Token and Associated Token programs.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: null,
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      tokenMetadata: receipt.tokenMetadata ?? null,
      phases: [withdrawPhase],
    };
  } catch (error) {
    return {
      source: "Meteora DLMM",
      status: "Failed",
      detail: error instanceof Error ? error.message : "Failed to build withdraw-to-owner fallback.",
      oldPositionAddress: receipt.oldPositionAddress,
      newPositionAddress: null,
      expectedNewLowerBin: expectedLowerBin,
      expectedNewUpperBin: expectedUpperBin,
      estimatedDepositXAmount: null,
      estimatedDepositYAmount: null,
      phases: [],
    };
  }
}
