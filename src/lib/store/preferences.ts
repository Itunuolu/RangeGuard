"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { clientConfig } from "@/lib/config";

type PreferencesState = {
  rpcEndpoint: string;
  slippageBps: number;
  riskPreference: "Conservative" | "Balanced" | "Aggressive";
  notificationsEnabled: boolean;
  acknowledgedRisk: boolean;
  setRpcEndpoint: (rpcEndpoint: string) => void;
  setSlippageBps: (slippageBps: number) => void;
  setRiskPreference: (riskPreference: PreferencesState["riskPreference"]) => void;
  setNotificationsEnabled: (notificationsEnabled: boolean) => void;
  setAcknowledgedRisk: (acknowledgedRisk: boolean) => void;
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      rpcEndpoint: clientConfig.solanaRpcUrl,
      slippageBps: 50,
      riskPreference: "Balanced",
      notificationsEnabled: false,
      acknowledgedRisk: false,
      setRpcEndpoint: (rpcEndpoint) => set({ rpcEndpoint }),
      setSlippageBps: (slippageBps) => set({ slippageBps }),
      setRiskPreference: (riskPreference) => set({ riskPreference }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setAcknowledgedRisk: (acknowledgedRisk) => set({ acknowledgedRisk }),
    }),
    {
      name: "rangeguard-preferences",
    },
  ),
);
