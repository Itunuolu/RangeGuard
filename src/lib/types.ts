export type RiskLabel = "Low" | "Medium" | "High" | "Avoid";

export type HealthStatus = "In range" | "Near edge" | "Out of range" | "Closed";

export type SuggestedActionType = "Hold" | "Claim fees" | "Rebalance" | "Exit";

export type StrategyRiskLevel = "Conservative" | "Balanced" | "Aggressive";

export type RangeWidth = "Tight" | "Medium" | "Wide";

export type PoolTypePreference = "Stable" | "Blue-chip" | "Any";

export type RebalanceTrigger = "Out of range" | "Near edge" | "Fee threshold";

export type TradingTierId = "TIER 1" | "TIER 2" | "TIER 3";

export type TradingTier = {
  id: TradingTierId;
  label: string;
  minCapitalUsd: number;
  maxCapitalUsd: number | null;
  profitDeductionBps: number;
  profitDeductionPct: number;
};

export type ProfitDeductionQuote = {
  tier: TradingTier | null;
  investedCapitalUsd: number;
  grossProfitUsd: number;
  deductionUsd: number;
  netProfitUsd: number;
  deductionBps: number;
  deductionPct: number;
  eligible: boolean;
  reason: string;
};

export type BridgeSyncCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type WalletPoolBridgeSimulation = {
  walletAddress: string | null;
  walletBalanceSol: number | null;
  walletTokenAccounts: number | null;
  pool: Pool;
  investedCapitalUsd: number;
  simulatedGrossProfitUsd: number;
  simulatedNetProfitUsd: number;
  profitDeductionUsd: number;
  profitDeductionBps: number;
  profitDeductionPct: number;
  tradingTier: TradingTier | null;
  tokenARatio: number;
  tokenBRatio: number;
  estimatedSlippageBps: number;
  estimatedPriceImpactPct: number;
  liquidityUtilizationPct: number;
  projectedFeeApr: number;
  routePlan: string[];
  syncChecks: BridgeSyncCheck[];
  canPrepareTrade: boolean;
};

export type TimePoint = {
  label: string;
  value: number;
};

export type Pool = {
  id: string;
  poolAddress: string;
  protocol: "Meteora DLMM";
  tokenAMint: string;
  tokenBMint: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  liquidityUsd: number;
  volume24hUsd: number;
  feeApr: number;
  volatilityScore: number;
  riskScore: number;
  riskLabel: RiskLabel;
  riskReasons: string[];
  activeBin: number | null;
  poolType: PoolTypePreference;
  tokenRiskScore: number;
  createdAt: string;
  updatedAt: string;
  lastScannedAt: string;
  liquidityHistory: TimePoint[];
  volumeHistory: TimePoint[];
  feeHistory: TimePoint[];
};

export type Strategy = {
  id: string;
  userId: string;
  name: string;
  riskLevel: StrategyRiskLevel;
  maxPositionSizeUsd: number;
  preferredPoolType: PoolTypePreference;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxRiskScore: number;
  rangeWidth: RangeWidth;
  rebalanceTrigger: RebalanceTrigger;
  stopLossPct: number;
  takeProfitPct: number;
  status: "Active" | "Paused" | "Archived";
  createdAt: string;
  updatedAt: string;
};

export type Position = {
  id: string;
  userId: string;
  strategyId: string | null;
  poolId: string;
  positionAddress: string | null;
  entryValueUsd: number;
  currentValueUsd: number;
  estimatedPnlUsd: number;
  estimatedPnlPct: number;
  feesEarnedUsd: number;
  lowerBin: number;
  upperBin: number;
  activeBinAtEntry: number | null;
  currentActiveBin: number | null;
  healthStatus: HealthStatus;
  healthScore: number;
  suggestedAction: SuggestedActionType;
  status: "Open" | "Closed";
  recoveryStatus?: "RecoveryRequired" | "Resolved" | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  pool: Pick<
    Pool,
    | "id"
    | "poolAddress"
    | "tokenASymbol"
    | "tokenBSymbol"
    | "protocol"
    | "riskLabel"
    | "riskScore"
    | "liquidityUsd"
    | "poolType"
  >;
  healthTimeline: TimePoint[];
  feeTimeline: TimePoint[];
  pnlTimeline: TimePoint[];
};

export type PositionEvent = {
  id: string;
  positionId: string;
  eventType:
    | "Position created"
    | "Position scanned"
    | "Rebalance suggested"
    | "Fees claimed"
    | "Position closed"
    | "Error";
  txSignature: string | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type KeeperExecutionPhaseResult = {
  phaseId: "remove-old-position" | "add-new-position" | string;
  status: "Simulated" | "Submitted" | string;
  signature: string;
  targetInstructionDigest: string;
  targetProgramIds: string[];
  instructionCount: number;
  unitsConsumed: number | null;
};

export type KeeperRecoveryMode = "RetryAddLiquidity" | "WithdrawToOwner";

export type KeeperReceiptTokenTransfer = {
  side?: "X" | "Y" | string;
  mint: string;
  amount: string;
  keeperTokenAccount?: string | null;
  ownerTokenAccount?: string | null;
  tokenProgramId?: string | null;
  signature?: string | null;
};

export type KeeperReceiptTokenMetadata = {
  source: "MeteoraDLMM";
  tokenXMint: string | null;
  tokenYMint: string | null;
  keeperTokenXAccount: string | null;
  keeperTokenYAccount: string | null;
  tokenXProgramId?: string | null;
  tokenYProgramId?: string | null;
  amountX: string | null;
  amountY: string | null;
  capturedAt: string;
  transfers: KeeperReceiptTokenTransfer[];
};

export type KeeperRecoveryPlan = {
  required: boolean;
  state:
    | "RecoveryRequired"
    | "RetrySimulated"
    | "RetrySubmitted"
    | "WithdrawSimulated"
    | "WithdrawSubmitted"
    | "Resolved";
  reason: string;
  sourceReceiptActionId?: string | null;
  retryAddLiquidity?: {
    status: "Available" | "Blocked" | "Simulated" | "Submitted";
    reason: string;
    expectedLowerBin: number | null;
    expectedUpperBin: number | null;
    freshNewPositionAddress?: string | null;
    signature?: string | null;
  };
  withdrawToOwner?: {
    status: "Available" | "Blocked" | "Simulated" | "Submitted";
    reason: string;
    ownerAddress?: string | null;
    tokenTransfers?: KeeperReceiptTokenTransfer[];
  };
};

export type KeeperExecutionReceipt = {
  persistedAt?: string;
  source: "rangeguard-autonomy" | string;
  requestType: "MeteoraFullRebalance" | string;
  actionId: string | null;
  policyId?: string | null;
  poolAddress: string | null;
  oldPositionAddress: string | null;
  newPositionAddress?: string | null;
  notionalUsd?: number | null;
  estimatedSlippageBps?: number | null;
  proposedLowerBin?: number | null;
  proposedUpperBin?: number | null;
  startedAt: string;
  completedAt?: string;
  status: "Executed" | "PostflightFailed" | "Failed" | string;
  estimatedDepositXAmount?: string | null;
  estimatedDepositYAmount?: string | null;
  expectedNewLowerBin?: number | null;
  expectedNewUpperBin?: number | null;
  tokenMetadata?: KeeperReceiptTokenMetadata | null;
  phaseResults?: KeeperExecutionPhaseResult[];
  recoverySource?: {
    actionId: string | null;
    startedAt?: string | null;
    phase1Signature?: string | null;
  } | null;
  recoveryResolution?: {
    actionId: string | null;
    completedAt?: string | null;
    mode: KeeperRecoveryMode | "Unknown";
    signature?: string | null;
    newPositionAddress?: string | null;
  } | null;
  recovery?: KeeperRecoveryPlan;
  postflight?: {
    ok: boolean;
    newPositionAddress: string;
    oldPositionClosed: boolean;
    owner: string;
    lowerBin: number;
    upperBin: number;
    activeBin: number;
    checks: Array<{
      id: string;
      passed: boolean;
      detail: string;
    }>;
  };
  build?: Record<string, unknown> | null;
  error?: string;
};

export type SuggestedAction = {
  id: string;
  userId: string;
  positionId: string;
  type: Exclude<SuggestedActionType, "Hold">;
  priority: "Low" | "Medium" | "High";
  status: "Open" | "Resolved" | "Dismissed";
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
};

export type DashboardSummary = {
  portfolioValueUsd: number;
  activePositions: number;
  estimatedFeesUsd: number;
  estimatedPnlUsd: number;
  estimatedPnlPct: number;
  suggestedActions: number;
};

export type BotMode = "ManualAutopilot" | "DelegatedAutonomy" | "CopySimulation";

export type BotPolicyStatus = "Draft" | "Paused" | "Armed" | "Disabled";

export type BotExecutionMode = "SuggestOnly" | "WalletConfirmed" | "DelegatedGuarded";

export type BotPolicy = {
  id: string;
  userId: string;
  name: string;
  mode: BotMode;
  status: BotPolicyStatus;
  executionMode: BotExecutionMode;
  maxPositionSizeUsd: number;
  dailyNotionalLimitUsd: number;
  maxSlippageBps: number;
  maxPoolRiskScore: number;
  minPoolLiquidityUsd: number;
  maxOpenPositions: number;
  dailyRebalanceLimit: number;
  stopLossPct: number;
  takeProfitPct: number;
  allowedPoolTypes: PoolTypePreference[];
  allowedPoolAddresses: string[];
  requireSimulation: boolean;
  requireWalletConfirm: boolean;
  guardProgramId: string | null;
  onChainPolicyAddress: string | null;
  delegatedAuthority: string | null;
  riskAuthority: string | null;
  policyHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GuardrailResult = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type BotActionStatus = "Planned" | "Blocked" | "Queued" | "NeedsWallet" | "Executed" | "Failed";

export type BotAction = {
  id: string;
  userId: string;
  policyId: string;
  runId: string | null;
  positionId: string | null;
  type: "OpenPosition" | "Rebalance" | "ClaimFees" | "ClosePosition" | "CopyLP";
  status: BotActionStatus;
  priority: "Low" | "Medium" | "High";
  protocol: "Meteora DLMM";
  title: string;
  reason: string;
  notionalUsd: number;
  estimatedFeeUsd: number;
  simulatedGrossProfitUsd?: number;
  estimatedSlippageBps: number;
  proposedLowerBin: number | null;
  proposedUpperBin: number | null;
  simulationStatus: "Pending" | "Passed" | "Failed";
  executionStatus:
    | "Disabled"
    | "AwaitingWallet"
    | "DelegationMissing"
    | "PolicyMissing"
    | "KeeperMissing"
    | "Ready"
    | "Submitted"
    | "Executed"
    | "Failed";
  guardrailResults: GuardrailResult[];
  transactionPlan: {
    steps: string[];
    requiresWalletSignature: boolean;
    requiresDelegatedAuthority: boolean;
    guardProgramId: string | null;
    onChainPolicyAddress?: string | null;
    actionHash?: string;
    guardInstructionBase64?: string | null;
    guardAccounts?: Array<{
      pubkey: string;
      isSigner: boolean;
      isWritable: boolean;
    }>;
    targetInstructions?: Array<{
      programId: string;
      keys: Array<{
        pubkey: string;
        isSigner: boolean;
        isWritable: boolean;
      }>;
      dataBase64: string;
    }>;
    targetInstructionDigest?: string | null;
    targetInstructionBuilder?: {
      source: "Meteora DLMM";
      status: "Built" | "Skipped" | "NeedsWalletSignature" | "Unsupported" | "Failed";
      detail: string;
      instructionCount: number;
      transactionCount: number;
      requiredSigners: string[];
      targetProgramIds: string[];
    };
    targetProgramIds?: string[];
    allowedProgramIds?: string[];
  };
  createdAt: string;
  queuedAt: string | null;
  executedAt: string | null;
  resolvedAt: string | null;
  position?: Position;
};

export type BotRun = {
  id: string;
  userId: string;
  policyId: string;
  status: "Completed" | "Running" | "Failed";
  mode: "DryRun" | "LiveGuarded";
  startedAt: string;
  finishedAt: string | null;
  positionsScanned: number;
  actionsPlanned: number;
  actionsBlocked: number;
  metadata: Record<string, unknown>;
};

export type CopyLpTarget = {
  id: string;
  rank: string;
  name: string;
  walletAddress: string;
  style: string;
  simulated30dPct: number;
  maxDrawdownPct: number;
  copiedPositions: number;
  status: "Simulation only" | "Needs review" | "Eligible";
};

export type BotControlPlane = {
  policy: BotPolicy;
  stats: {
    openPositions: number;
    deployedTodayUsd: number;
    totalPositionsOpened: number;
    realizedPnlUsd: number;
    dailyLimitUsedUsd: number;
    dailyLimitUsd: number;
    plannedActions: number;
    blockedActions: number;
  };
  actions: BotAction[];
  runs: BotRun[];
  copyTargets: CopyLpTarget[];
  protocolReadiness: {
    executionEnabled: boolean;
    guardProgramConfigured: boolean;
    keeperConfigured: boolean;
    riskAuthorityConfigured: boolean;
    policyAccountConfigured: boolean;
    remoteSignerConfigured: boolean;
    allowedProgramsConfigured: boolean;
    canExecuteAutonomously: boolean;
    blockers: string[];
  };
  executionReceipts: KeeperExecutionReceipt[];
  receiptPersistence: {
    databaseConfigured: boolean;
    receiptPath: string;
    receiptsFound: number;
  };
};
