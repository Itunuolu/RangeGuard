import type {
  BotControlPlane,
  DashboardSummary,
  KeeperExecutionReceipt,
  Pool,
  Position,
  PositionEvent,
  Strategy,
  SuggestedAction,
  TradingTier,
  WalletPoolBridgeSimulation,
} from "@/lib/types";
import { clientConfig } from "@/lib/config";
import {
  getPoolByAddress,
  getPositionById,
  mockBotPolicy,
  mockCopyTargets,
  mockEvents,
  mockPools,
  mockPositions,
  mockSuggestedActions,
  mockSummary,
} from "@/lib/mock/data";
import { simulateWalletPoolBridge } from "@/lib/protocol/tradeBridge";
import { tierSummary } from "@/lib/protocol/tradingTiers";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function staticUserId(walletAddress?: string | null) {
  return walletAddress ? `user-${walletAddress.slice(0, 8)}` : "user-demo";
}

function staticBotControlPlane(walletAddress?: string | null): BotControlPlane {
  const userId = staticUserId(walletAddress);
  const policy = {
    ...mockBotPolicy,
    userId,
    policyHash: "static-export-demo",
  };
  const openPositions = mockPositions.filter((position) => position.status === "Open");
  const actions: BotControlPlane["actions"] = openPositions
    .filter((position) => position.suggestedAction !== "Hold")
    .map((position) => {
      const type =
        position.suggestedAction === "Claim fees"
          ? "ClaimFees"
          : position.suggestedAction === "Exit"
            ? "ClosePosition"
            : "Rebalance";
      const notionalUsd = type === "ClaimFees" ? position.feesEarnedUsd : position.currentValueUsd;
      const proposedLowerBin =
        type === "Rebalance" && position.currentActiveBin !== null ? position.currentActiveBin - 40 : null;
      const proposedUpperBin =
        type === "Rebalance" && position.currentActiveBin !== null ? position.currentActiveBin + 40 : null;

      return {
        id: `static-action-${position.id}-${type.toLowerCase()}`,
        userId,
        policyId: policy.id,
        runId: "static-run-latest",
        positionId: position.id,
        type,
        status: "NeedsWallet",
        priority: type === "Rebalance" ? "High" : "Medium",
        protocol: "Meteora DLMM",
        title:
          type === "ClaimFees"
            ? `Claim fees on ${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`
            : type === "ClosePosition"
              ? `Close ${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`
              : `Rebalance ${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`,
        reason:
          type === "ClaimFees"
            ? "Fees are above the monitoring threshold while the range remains healthy."
            : "The active bin is outside or near the selected range, so a manual review is suggested.",
        notionalUsd,
        estimatedFeeUsd: 0.0025,
        simulatedGrossProfitUsd: Math.max(0, position.estimatedPnlUsd + position.feesEarnedUsd),
        estimatedSlippageBps: type === "Rebalance" ? 42 : 0,
        proposedLowerBin,
        proposedUpperBin,
        simulationStatus: "Passed",
        executionStatus: "AwaitingWallet",
        guardrailResults: [
          {
            id: "static-export",
            label: "Static Pages demo",
            passed: true,
            detail: "GitHub Pages is running in bundled mock mode; no transaction can be submitted.",
          },
          {
            id: "wallet-confirmation",
            label: "Wallet confirmation required",
            passed: true,
            detail: "Manual wallet review remains required for every action.",
          },
        ],
        transactionPlan: {
          steps:
            type === "Rebalance"
              ? [
                  "Fetch active bin from bundled demo data",
                  "Preview new DLMM range",
                  "Require wallet-confirmed transaction in a server deployment",
                ]
              : ["Preview claimable fees", "Require wallet-confirmed transaction in a server deployment"],
          requiresWalletSignature: true,
          requiresDelegatedAuthority: false,
          guardProgramId: null,
          onChainPolicyAddress: null,
          actionHash: undefined,
          guardInstructionBase64: null,
          guardAccounts: [],
          targetProgramIds: [],
          allowedProgramIds: [],
        },
        createdAt: "2026-05-22T09:00:00.000Z",
        queuedAt: null,
        executedAt: null,
        resolvedAt: null,
        position,
      };
    });

  return {
    policy,
    stats: {
      openPositions: openPositions.length,
      deployedTodayUsd: 0,
      totalPositionsOpened: openPositions.length,
      realizedPnlUsd: mockPositions.reduce((sum, position) => sum + position.estimatedPnlUsd, 0),
      dailyLimitUsedUsd: actions.reduce((sum, action) => sum + action.notionalUsd, 0),
      dailyLimitUsd: policy.dailyNotionalLimitUsd,
      plannedActions: actions.length,
      blockedActions: 0,
    },
    actions,
    runs: [
      {
        id: "static-run-latest",
        userId,
        policyId: policy.id,
        status: "Completed",
        mode: "DryRun",
        startedAt: "2026-05-22T09:00:00.000Z",
        finishedAt: "2026-05-22T09:00:02.000Z",
        positionsScanned: openPositions.length,
        actionsPlanned: actions.length,
        actionsBlocked: 0,
        metadata: {
          deployment: "github-pages",
        },
      },
    ],
    copyTargets: mockCopyTargets,
    protocolReadiness: {
      executionEnabled: false,
      guardProgramConfigured: false,
      keeperConfigured: false,
      riskAuthorityConfigured: false,
      policyAccountConfigured: false,
      remoteSignerConfigured: false,
      allowedProgramsConfigured: false,
      canExecuteAutonomously: false,
      blockers: [
        "GitHub Pages is static hosting, so server-side guarded execution is disabled.",
        "Deploy to a Node.js host to enable API routes, workers, keeper receipts, and live RPC-backed reads.",
      ],
    },
    executionReceipts: [],
    receiptPersistence: {
      databaseConfigured: false,
      receiptPath: "Unavailable on GitHub Pages static hosting",
      receiptsFound: 0,
    },
  };
}

export function fetchDashboard(walletAddress?: string) {
  if (clientConfig.staticExport) {
    const topPools = [...mockPools]
      .sort((a, b) => a.riskScore - b.riskScore || b.volume24hUsd - a.volume24hUsd)
      .slice(0, 4);

    return Promise.resolve({
      summary: mockSummary,
      recentActivity: mockEvents.slice(0, 5),
      topPools,
      suggestedActions: mockSuggestedActions,
    });
  }

  const query = walletAddress ? `?wallet=${encodeURIComponent(walletAddress)}` : "";
  return request<{
    summary: DashboardSummary;
    recentActivity: PositionEvent[];
    topPools: Pool[];
    suggestedActions: SuggestedAction[];
  }>(`/api/dashboard${query}`);
}

export function fetchPools() {
  if (clientConfig.staticExport) {
    return Promise.resolve({ pools: mockPools });
  }

  return request<{ pools: Pool[] }>("/api/pools");
}

export function fetchPool(poolAddress: string) {
  if (clientConfig.staticExport) {
    const pool = getPoolByAddress(poolAddress);
    return pool ? Promise.resolve({ pool }) : Promise.reject(new Error("Pool not found"));
  }

  return request<{ pool: Pool }>(`/api/pools/${poolAddress}`);
}

export function fetchPositions(walletAddress?: string) {
  if (clientConfig.staticExport) {
    return Promise.resolve({
      positions: mockPositions.map((position) => ({ ...position, userId: staticUserId(walletAddress) })),
      suggestedActions: mockSuggestedActions,
    });
  }

  const query = walletAddress ? `?wallet=${encodeURIComponent(walletAddress)}` : "";
  return request<{ positions: Position[]; suggestedActions: SuggestedAction[] }>(`/api/positions${query}`);
}

export function fetchPosition(positionId: string) {
  if (clientConfig.staticExport) {
    const position = getPositionById(positionId);
    if (!position) return Promise.reject(new Error("Position not found"));

    return Promise.resolve({
      position,
      events: mockEvents
        .filter((event) => event.positionId === positionId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      suggestedAction: mockSuggestedActions.find((action) => action.positionId === positionId) || null,
    });
  }

  return request<{ position: Position; events: PositionEvent[]; suggestedAction: SuggestedAction | null }>(
    `/api/positions/${positionId}`,
  );
}

export function fetchActivity() {
  if (clientConfig.staticExport) {
    return Promise.resolve({ events: mockEvents });
  }

  return request<{ events: PositionEvent[] }>("/api/activity");
}

export function fetchBotControlPlane(walletAddress?: string) {
  if (clientConfig.staticExport) {
    return Promise.resolve(staticBotControlPlane(walletAddress));
  }

  const query = walletAddress ? `?wallet=${encodeURIComponent(walletAddress)}` : "";
  return request<BotControlPlane>(`/api/bot${query}`);
}

export function fetchTradingBridge(input: {
  walletAddress?: string;
  poolAddress?: string;
  capitalUsd?: number;
  grossProfitUsd?: number;
  horizonDays?: number;
}) {
  if (clientConfig.staticExport) {
    const pool = (input.poolAddress ? getPoolByAddress(input.poolAddress) : null) || mockPools[0];

    return Promise.resolve({
      pools: mockPools,
      bridge: simulateWalletPoolBridge({
        walletAddress: input.walletAddress,
        walletBalanceSol: input.walletAddress ? 18.42 : null,
        walletTokenAccounts: input.walletAddress ? 7 : null,
        pool,
        investedCapitalUsd: input.capitalUsd ?? 2_500,
        simulatedGrossProfitUsd: input.grossProfitUsd ?? 0,
        horizonDays: input.horizonDays ?? 30,
      }),
      tiers: tierSummary(),
    });
  }

  const params = new URLSearchParams();
  if (input.walletAddress) params.set("wallet", input.walletAddress);
  if (input.poolAddress) params.set("pool", input.poolAddress);
  if (input.capitalUsd !== undefined) params.set("capitalUsd", String(input.capitalUsd));
  if (input.grossProfitUsd !== undefined) params.set("grossProfitUsd", String(input.grossProfitUsd));
  if (input.horizonDays !== undefined) params.set("horizonDays", String(input.horizonDays));

  return request<{
    pools: Pool[];
    bridge: WalletPoolBridgeSimulation;
    tiers: Array<TradingTier & { deductionLabel: string }>;
  }>(`/api/trading/bridge?${params.toString()}`);
}

export function simulateBotAction(actionId: string) {
  if (clientConfig.staticExport) {
    const action = staticBotControlPlane().actions.find((candidate) => candidate.id === actionId);

    return Promise.resolve({
      preview: {
        actionId,
        canSubmit: false,
        status: action ? "WalletRequired" : "Blocked",
        reasons: [
          action
            ? "GitHub Pages static hosting cannot submit guarded actions."
            : "Bot action not found in bundled demo data.",
        ],
        transactionPlan: action?.transactionPlan || {
          steps: [],
          requiresWalletSignature: true,
          requiresDelegatedAuthority: false,
          guardProgramId: null,
        },
      },
    });
  }

  return request<{
    preview: {
      actionId: string;
      canSubmit: boolean;
      status: string;
      reasons: string[];
      transactionPlan: {
        steps: string[];
        requiresWalletSignature: boolean;
        requiresDelegatedAuthority: boolean;
        guardProgramId: string | null;
      };
    };
  }>(`/api/bot/actions/${actionId}/simulate`, {
    method: "POST",
  });
}

export function executeBotAction(actionId: string, walletAddress?: string) {
  if (clientConfig.staticExport) {
    return Promise.resolve({
      result: {
        actionId,
        submitted: false,
        status: "WalletRequired",
        reasons: [
          "This GitHub Pages build is a static mock deployment. Use the server deployment for keeper submission.",
          walletAddress ? `Connected wallet preview: ${walletAddress}` : "Connect a wallet in a server deployment.",
        ],
      },
    });
  }

  return fetch(`/api/bot/actions/${actionId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  }).then((response) => response.json()) as Promise<{
    result: {
      actionId: string;
      submitted: boolean;
      status: string;
      reasons: string[];
      keeperResponse?: unknown;
    };
  }>;
}

type RecoveryActionResult = {
  result: {
    mode: "RetryAddLiquidity" | "WithdrawToOwner";
    receiptActionId: string | null;
    submitted: boolean;
    status: string;
    reasons: string[];
    keeperResponse?: unknown;
  };
};

function receiptLocator(receipt: KeeperExecutionReceipt, walletAddress?: string) {
  return {
    actionId: receipt.actionId,
    startedAt: receipt.startedAt,
    walletAddress,
  };
}

export function retryRecoveryAddLiquidity(receipt: KeeperExecutionReceipt, walletAddress?: string) {
  if (clientConfig.staticExport) {
    return Promise.resolve({
      result: {
        mode: "RetryAddLiquidity" as const,
        receiptActionId: receipt.actionId,
        submitted: false,
        status: "Blocked",
        reasons: [
          "Recovery retries require the keeper signer API and are unavailable on GitHub Pages static hosting.",
          walletAddress ? `Connected wallet preview: ${walletAddress}` : "No wallet connected.",
        ],
      },
    });
  }

  return fetch("/api/bot/recovery/retry-add-liquidity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(receiptLocator(receipt, walletAddress)),
  }).then((response) => response.json()) as Promise<RecoveryActionResult>;
}

export function withdrawRecoveryToOwner(
  receipt: KeeperExecutionReceipt,
  input: {
    walletAddress?: string;
    ownerAddress?: string;
  tokenTransfers?: Array<{ mint: string; amount: string; tokenProgramId?: string | null }>;
  },
) {
  if (clientConfig.staticExport) {
    return Promise.resolve({
      result: {
        mode: "WithdrawToOwner" as const,
        receiptActionId: receipt.actionId,
        submitted: false,
        status: "Blocked",
        reasons: [
          "Recovery withdrawals require the keeper signer API and are unavailable on GitHub Pages static hosting.",
          input.ownerAddress ? `Owner preview: ${input.ownerAddress}` : "No owner wallet supplied.",
        ],
      },
    });
  }

  return fetch("/api/bot/recovery/withdraw-to-owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...receiptLocator(receipt, input.walletAddress),
      ownerAddress: input.ownerAddress,
      tokenTransfers: input.tokenTransfers || [],
    }),
  }).then((response) => response.json()) as Promise<RecoveryActionResult>;
}

export function saveStrategy(strategy: Omit<Strategy, "id" | "userId" | "status" | "createdAt" | "updatedAt"> & { walletAddress?: string }) {
  if (clientConfig.staticExport) {
    const now = new Date().toISOString();

    return Promise.resolve({
      strategy: {
        id: `static-strategy-${Date.now()}`,
        userId: staticUserId(strategy.walletAddress),
        name: strategy.name,
        riskLevel: strategy.riskLevel,
        maxPositionSizeUsd: strategy.maxPositionSizeUsd,
        preferredPoolType: strategy.preferredPoolType,
        minLiquidityUsd: strategy.minLiquidityUsd,
        minVolume24hUsd: strategy.minVolume24hUsd,
        maxRiskScore: strategy.maxRiskScore,
        rangeWidth: strategy.rangeWidth,
        rebalanceTrigger: strategy.rebalanceTrigger,
        stopLossPct: strategy.stopLossPct,
        takeProfitPct: strategy.takeProfitPct,
        status: "Active" as const,
        createdAt: now,
        updatedAt: now,
      },
      persisted: false,
    });
  }

  return request<{ strategy: Strategy; persisted: boolean }>("/api/strategies", {
    method: "POST",
    body: JSON.stringify(strategy),
  });
}
