import { NextResponse } from "next/server";

import { getMeteoraDlmmAdapter } from "@/lib/adapters/meteoraDlmm";
import { mockEvents, mockPositions, mockSuggestedActions, mockSummary } from "@/lib/mock/data";

export async function GET() {
  const meteora = getMeteoraDlmmAdapter();
  const pools = await meteora.listPools();
  const topPools = [...pools].sort((a, b) => a.riskScore - b.riskScore || b.volume24hUsd - a.volume24hUsd).slice(0, 4);
  const summary = {
    ...mockSummary,
    portfolioValueUsd: mockPositions.reduce((sum, position) => sum + position.currentValueUsd, 0),
    activePositions: mockPositions.filter((position) => position.status === "Open").length,
  };

  return NextResponse.json({
    summary,
    recentActivity: mockEvents.slice(0, 5),
    topPools,
    suggestedActions: mockSuggestedActions,
  });
}
