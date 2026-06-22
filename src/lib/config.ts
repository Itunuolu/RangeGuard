export const isServerMockMode = process.env.MOCK_MODE !== "false";

export const serverConfig = {
  mockMode: isServerMockMode,
  solanaRpcUrl:
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com",
  jupiterApiKey: process.env.JUPITER_API_KEY || "",
  autonomyExecutionEnabled: process.env.AUTONOMY_EXECUTION_ENABLED === "true",
  autonomyGuardProgramId: process.env.AUTONOMY_GUARD_PROGRAM_ID || "",
  autonomyPolicyAddress: process.env.AUTONOMY_POLICY_ADDRESS || "",
  autonomyKeeperAuthority: process.env.AUTONOMY_KEEPER_AUTHORITY || "",
  autonomyRiskAuthority: process.env.AUTONOMY_RISK_AUTHORITY || "",
  autonomyKeeperSignerUrl: process.env.AUTONOMY_KEEPER_SIGNER_URL || "",
  autonomyAllowedProgramIds: (process.env.AUTONOMY_ALLOWED_PROGRAM_IDS || "")
    .split(",")
    .map((programId) => programId.trim())
    .filter(Boolean),
};

export const clientConfig = {
  mockMode: process.env.NEXT_PUBLIC_MOCK_MODE !== "false",
  staticExport: process.env.NEXT_PUBLIC_STATIC_EXPORT === "true",
  solanaRpcUrl:
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
};
