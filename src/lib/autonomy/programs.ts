import { PublicKey } from "@solana/web3.js";

export function parsePublicKey(value: string | null | undefined) {
  if (!value) return null;

  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export function validProgramIds(programIds: string[]) {
  return programIds.filter((programId) => Boolean(parsePublicKey(programId)));
}

export function invalidProgramIds(programIds: string[]) {
  return programIds.filter((programId) => !parsePublicKey(programId));
}
