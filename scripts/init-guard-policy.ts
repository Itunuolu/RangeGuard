import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
const MAX_ALLOWED_PROGRAMS = 16;
const MAX_ALLOWED_POOLS = 32;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function pubkey(name: string) {
  return new PublicKey(required(name));
}

function keypair(path: string) {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function discriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function u64(value: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(Math.round(value)));
  return buffer;
}

function u16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function vecPubkeys(values: PublicKey[]) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(values.length);
  return Buffer.concat([length, ...values.map((value) => value.toBuffer())]);
}

function csvPubkeys(raw: string | undefined, max: number, name: string) {
  const values = (raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new PublicKey(value));

  if (values.length > max) throw new Error(`${name} supports at most ${max} public keys.`);
  return values;
}

function usdMicros(value: number) {
  return value * 1_000_000;
}

function poolTypeMask() {
  const raw = process.env.RANGEGUARD_ALLOWED_POOL_TYPES || "Stable,Blue-chip";
  const names = raw.split(",").map((value) => value.trim().toLowerCase());
  let mask = 0;
  if (names.includes("stable")) mask |= 1;
  if (names.includes("blue-chip") || names.includes("bluechip")) mask |= 2;
  if (names.includes("any")) mask |= 4;
  if (mask === 0) throw new Error("RANGEGUARD_ALLOWED_POOL_TYPES must include Stable, Blue-chip, or Any.");
  return mask;
}

function policyInputData() {
  const allowedPrograms = csvPubkeys(
    process.env.AUTONOMY_ALLOWED_PROGRAM_IDS,
    MAX_ALLOWED_PROGRAMS,
    "AUTONOMY_ALLOWED_PROGRAM_IDS",
  );
  const allowedPools = csvPubkeys(process.env.RANGEGUARD_ALLOWED_POOL_ADDRESSES, MAX_ALLOWED_POOLS, "RANGEGUARD_ALLOWED_POOL_ADDRESSES");

  return Buffer.concat([
    pubkey("AUTONOMY_KEEPER_AUTHORITY").toBuffer(),
    pubkey("AUTONOMY_RISK_AUTHORITY").toBuffer(),
    u64(usdMicros(optionalNumber("RANGEGUARD_MAX_POSITION_SIZE_USD", 2_500))),
    u64(usdMicros(optionalNumber("RANGEGUARD_DAILY_NOTIONAL_LIMIT_USD", 5_000))),
    u16(optionalNumber("RANGEGUARD_MAX_SLIPPAGE_BPS", 50)),
    Buffer.from([optionalNumber("RANGEGUARD_MAX_POOL_RISK_SCORE", 60)]),
    u64(usdMicros(optionalNumber("RANGEGUARD_MIN_POOL_LIQUIDITY_USD", 500_000))),
    Buffer.from([optionalNumber("RANGEGUARD_MAX_OPEN_POSITIONS", 10)]),
    Buffer.from([optionalNumber("RANGEGUARD_DAILY_REBALANCE_LIMIT", 6)]),
    u16(optionalNumber("RANGEGUARD_STOP_LOSS_BPS", 800)),
    u16(optionalNumber("RANGEGUARD_TAKE_PROFIT_BPS", 2_500)),
    Buffer.from([poolTypeMask()]),
    vecPubkeys(allowedPrograms),
    vecPubkeys(allowedPools),
  ]);
}

function setPolicyPausedIx(programId: PublicKey, policyAddress: PublicKey, owner: PublicKey, paused: boolean) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: policyAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([discriminator("set_policy_paused"), Buffer.from([paused ? 1 : 0])]),
  });
}

async function main() {
  const owner = keypair(required("RANGEGUARD_POLICY_OWNER_KEYPAIR"));
  const programId = pubkey("AUTONOMY_GUARD_PROGRAM_ID");
  const connection = new Connection(process.env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC, "confirmed");
  const [derivedPolicyAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("rangeguard-policy"), owner.publicKey.toBuffer()],
    programId,
  );
  const configuredPolicy = process.env.AUTONOMY_POLICY_ADDRESS
    ? new PublicKey(process.env.AUTONOMY_POLICY_ADDRESS)
    : derivedPolicyAddress;

  if (!configuredPolicy.equals(derivedPolicyAddress)) {
    throw new Error(
      `AUTONOMY_POLICY_ADDRESS must be the policy PDA for this owner/program. Expected ${derivedPolicyAddress.toBase58()}.`,
    );
  }

  const existing = await connection.getAccountInfo(derivedPolicyAddress);
  const action = existing ? "update_policy" : "initialize_policy";
  const keys = existing
    ? [
        { pubkey: derivedPolicyAddress, isSigner: false, isWritable: true },
        { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      ]
    : [
        { pubkey: derivedPolicyAddress, isSigner: false, isWritable: true },
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys,
      data: Buffer.concat([discriminator(action), policyInputData()]),
    }),
  );

  if (process.env.RANGEGUARD_POLICY_ARM === "true") {
    tx.add(setPolicyPausedIx(programId, derivedPolicyAddress, owner.publicKey, false));
  }

  const signature = await sendAndConfirmTransaction(connection, tx, [owner], {
    commitment: "confirmed",
  });

  console.log(`[RangeGuard Policy] ${action} confirmed: ${signature}`);
  console.log(`AUTONOMY_POLICY_ADDRESS="${derivedPolicyAddress.toBase58()}"`);
  console.log(`RANGEGUARD_POLICY_OWNER="${owner.publicKey.toBase58()}"`);
  console.log(`RANGEGUARD_POLICY_PAUSED="${process.env.RANGEGUARD_POLICY_ARM === "true" ? "false" : "true"}"`);
}

main().catch((error) => {
  console.error("[RangeGuard Policy] initialization failed");
  console.error(error);
  process.exitCode = 1;
});
