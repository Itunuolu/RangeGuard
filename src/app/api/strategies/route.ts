import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getPrismaClient } from "@/lib/db";
import type { Strategy } from "@/lib/types";

const strategySchema = z.object({
  walletAddress: z.string().optional(),
  name: z.string().min(2),
  riskLevel: z.enum(["Conservative", "Balanced", "Aggressive"]),
  maxPositionSizeUsd: z.number().positive(),
  preferredPoolType: z.enum(["Stable", "Blue-chip", "Any"]),
  minLiquidityUsd: z.number().nonnegative(),
  minVolume24hUsd: z.number().nonnegative(),
  maxRiskScore: z.number().int().min(1).max(100),
  rangeWidth: z.enum(["Tight", "Medium", "Wide"]),
  rebalanceTrigger: z.enum(["Out of range", "Near edge", "Fee threshold"]),
  stopLossPct: z.number().nonnegative(),
  takeProfitPct: z.number().nonnegative(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = strategySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid strategy", issues: parsed.error.flatten() }, { status: 400 });
  }

  const now = new Date().toISOString();
  const walletAddress = parsed.data.walletAddress || "mock-wallet";
  const prisma = await getPrismaClient();

  if (prisma && process.env.MOCK_MODE === "false") {
    try {
      const user = await prisma.user.upsert({
        where: { walletAddress },
        update: {},
        create: { walletAddress },
      });
      const strategy = await prisma.strategy.create({
        data: {
          userId: user.id,
          name: parsed.data.name,
          riskLevel: parsed.data.riskLevel,
          maxPositionSizeUsd: parsed.data.maxPositionSizeUsd,
          preferredPoolType: parsed.data.preferredPoolType,
          minLiquidityUsd: parsed.data.minLiquidityUsd,
          minVolume24hUsd: parsed.data.minVolume24hUsd,
          maxRiskScore: parsed.data.maxRiskScore,
          rangeWidth: parsed.data.rangeWidth,
          rebalanceTrigger: parsed.data.rebalanceTrigger,
          stopLossPct: parsed.data.stopLossPct,
          takeProfitPct: parsed.data.takeProfitPct,
          status: "Active",
        },
      });
      return NextResponse.json({ strategy, persisted: true });
    } catch {
      // Fall through to an in-memory response so the MVP remains usable without a live database.
    }
  }

  const strategy: Strategy = {
    id: `strategy-${Date.now()}`,
    userId: "user-demo",
    name: parsed.data.name,
    riskLevel: parsed.data.riskLevel,
    maxPositionSizeUsd: parsed.data.maxPositionSizeUsd,
    preferredPoolType: parsed.data.preferredPoolType,
    minLiquidityUsd: parsed.data.minLiquidityUsd,
    minVolume24hUsd: parsed.data.minVolume24hUsd,
    maxRiskScore: parsed.data.maxRiskScore,
    rangeWidth: parsed.data.rangeWidth,
    rebalanceTrigger: parsed.data.rebalanceTrigger,
    stopLossPct: parsed.data.stopLossPct,
    takeProfitPct: parsed.data.takeProfitPct,
    status: "Active",
    createdAt: now,
    updatedAt: now,
  };

  return NextResponse.json({ strategy, persisted: false });
}
