import { createHash } from "node:crypto";
import { SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction } from "@solana/web3.js";

import { hashBotAction } from "@/lib/autonomy/actionHash";
import { parsePublicKey, validProgramIds } from "@/lib/autonomy/programs";
import { serverConfig } from "@/lib/config";
import type { BotAction, BotPolicy } from "@/lib/types";

const METEORA_DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const JUPITER_AGGREGATOR_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

const actionTypeCode: Record<BotAction["type"], number> = {
  OpenPosition: 1,
  Rebalance: 2,
  ClaimFees: 3,
  ClosePosition: 4,
  CopyLP: 5,
};

function writeU64Le(value: bigint) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

function writeI32Le(value: number | null) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value ?? 0);
  return bytes;
}

function actionTypeIndex(actionType: BotAction["type"]) {
  return actionTypeCode[actionType] - 1;
}

function poolTypeIndex(action: BotAction) {
  const poolType = action.position?.pool.poolType;

  if (poolType === "Stable") return 0;
  if (poolType === "Blue-chip") return 1;
  return 2;
}

function writePubkey(value: string | null | undefined) {
  const pubkey = parsePublicKey(value);
  return pubkey?.toBuffer() || Buffer.alloc(32);
}

function writeVecPubkeys(programIds: string[]) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(programIds.length);

  return Buffer.concat([length, ...programIds.map((programId) => writePubkey(programId))]);
}

function writeU16Le(value: number) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function instructionDiscriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

export function targetProgramIdsForAction(action: BotAction) {
  if (action.transactionPlan.targetProgramIds?.length) {
    return action.transactionPlan.targetProgramIds;
  }

  if (action.type === "Rebalance" || action.type === "OpenPosition" || action.type === "CopyLP") {
    return [METEORA_DLMM_PROGRAM_ID, JUPITER_AGGREGATOR_PROGRAM_ID];
  }

  return [METEORA_DLMM_PROGRAM_ID];
}

export function buildGuardedActionInstruction(policy: BotPolicy, action: BotAction) {
  const targetProgramIds = targetProgramIdsForAction(action);
  const guardProgram = parsePublicKey(policy.guardProgramId);
  const policyAccount = parsePublicKey(policy.onChainPolicyAddress);
  const delegatedAuthority = parsePublicKey(policy.delegatedAuthority);
  const riskAuthority = parsePublicKey(policy.riskAuthority);
  const poolAddress = parsePublicKey(action.position?.pool.poolAddress);
  const allowedProgramIds = validProgramIds(serverConfig.autonomyAllowedProgramIds);
  const actionWithTargets: BotAction = {
    ...action,
    transactionPlan: {
      ...action.transactionPlan,
      targetProgramIds,
      allowedProgramIds,
      guardProgramId: policy.guardProgramId,
      onChainPolicyAddress: policy.onChainPolicyAddress,
    },
  };
  const actionHash = hashBotAction(actionWithTargets);

  if (!guardProgram || !policyAccount || !delegatedAuthority || !riskAuthority || !poolAddress) {
    return {
      actionHash,
      guardInstructionBase64: null,
      guardAccounts: [],
      targetProgramIds,
      allowedProgramIds,
      error:
        "Guard program, on-chain policy account, delegated authority, risk authority, or pool address is not a valid Solana public key.",
    };
  }

  const ix = new TransactionInstruction({
    programId: guardProgram,
    keys: [
      { pubkey: policyAccount, isSigner: false, isWritable: true },
      { pubkey: delegatedAuthority, isSigner: true, isWritable: false },
      { pubkey: riskAuthority, isSigner: true, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      instructionDiscriminator("execute_guarded_action"),
      Buffer.from(actionHash, "hex"),
      Buffer.from([actionTypeIndex(action.type)]),
      poolAddress.toBuffer(),
      Buffer.from([poolTypeIndex(action)]),
      writeVecPubkeys(targetProgramIds),
      writeU64Le(BigInt(Math.max(0, Math.round(action.notionalUsd * 1_000_000)))),
      writeU16Le(action.estimatedSlippageBps),
      Buffer.from([Math.max(0, Math.min(100, action.position?.pool.riskScore || policy.maxPoolRiskScore))]),
      writeU64Le(BigInt(Math.max(0, Math.round((action.position?.pool.liquidityUsd || 0) * 1_000_000)))),
      Buffer.from([Math.max(0, Math.min(255, policy.maxOpenPositions))]),
      writeI32Le(action.proposedLowerBin),
      writeI32Le(action.proposedUpperBin),
    ]),
  });

  return {
    actionHash,
    guardInstructionBase64: ix.data.toString("base64"),
    guardAccounts: ix.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    targetProgramIds,
    allowedProgramIds,
    error: null,
  };
}

export function attachGuardPlan(policy: BotPolicy, action: BotAction): BotAction {
  const guardPlan = buildGuardedActionInstruction(policy, action);

  return {
    ...action,
    transactionPlan: {
      ...action.transactionPlan,
      guardProgramId: policy.guardProgramId,
      onChainPolicyAddress: policy.onChainPolicyAddress,
      actionHash: guardPlan.actionHash,
      guardInstructionBase64: guardPlan.guardInstructionBase64,
      guardAccounts: guardPlan.guardAccounts,
      targetProgramIds: guardPlan.targetProgramIds,
      allowedProgramIds: guardPlan.allowedProgramIds,
    },
  };
}
