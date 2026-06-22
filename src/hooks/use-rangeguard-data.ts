"use client";

import { useQuery } from "@tanstack/react-query";

import {
  fetchActivity,
  fetchBotControlPlane,
  fetchDashboard,
  fetchPool,
  fetchPools,
  fetchPosition,
  fetchPositions,
  fetchTradingBridge,
} from "@/lib/api/client";

export function useDashboard(walletAddress?: string) {
  return useQuery({
    queryKey: ["dashboard", walletAddress],
    queryFn: () => fetchDashboard(walletAddress),
  });
}

export function usePools() {
  return useQuery({
    queryKey: ["pools"],
    queryFn: fetchPools,
  });
}

export function usePool(poolAddress: string) {
  return useQuery({
    queryKey: ["pool", poolAddress],
    queryFn: () => fetchPool(poolAddress),
    enabled: Boolean(poolAddress),
  });
}

export function usePositions(walletAddress?: string) {
  return useQuery({
    queryKey: ["positions", walletAddress],
    queryFn: () => fetchPositions(walletAddress),
  });
}

export function usePosition(positionId: string) {
  return useQuery({
    queryKey: ["position", positionId],
    queryFn: () => fetchPosition(positionId),
    enabled: Boolean(positionId),
  });
}

export function useActivity() {
  return useQuery({
    queryKey: ["activity"],
    queryFn: fetchActivity,
  });
}

export function useBotControlPlane(walletAddress?: string) {
  return useQuery({
    queryKey: ["bot-control-plane", walletAddress],
    queryFn: () => fetchBotControlPlane(walletAddress),
  });
}

export function useTradingBridge(input: {
  walletAddress?: string;
  poolAddress?: string;
  capitalUsd?: number;
  grossProfitUsd?: number;
  horizonDays?: number;
}) {
  return useQuery({
    queryKey: ["trading-bridge", input.walletAddress, input.poolAddress, input.capitalUsd, input.grossProfitUsd, input.horizonDays],
    queryFn: () => fetchTradingBridge(input),
  });
}
