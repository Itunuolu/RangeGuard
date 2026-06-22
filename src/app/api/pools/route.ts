import { NextRequest, NextResponse } from "next/server";

import { getMeteoraDlmmAdapter } from "@/lib/adapters/meteoraDlmm";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const meteora = getMeteoraDlmmAdapter();
  const pools = await meteora.listPools({
    stableOnly: params.get("stableOnly") === "true",
    minLiquidityUsd: Number(params.get("minLiquidityUsd") || 0),
    minVolume24hUsd: Number(params.get("minVolume24hUsd") || 0),
    riskLabel: params.get("riskLabel") || undefined,
  });

  return NextResponse.json({ pools });
}
