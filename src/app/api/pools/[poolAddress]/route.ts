import { NextRequest, NextResponse } from "next/server";

import { getMeteoraDlmmAdapter } from "@/lib/adapters/meteoraDlmm";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ poolAddress: string }> }) {
  const { poolAddress } = await params;
  const meteora = getMeteoraDlmmAdapter();
  const pool = await meteora.getPool(decodeURIComponent(poolAddress));

  if (!pool) {
    return NextResponse.json({ error: "Pool not found" }, { status: 404 });
  }

  return NextResponse.json({ pool });
}
