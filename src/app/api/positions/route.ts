import { NextRequest, NextResponse } from "next/server";

import { getMeteoraDlmmAdapter } from "@/lib/adapters/meteoraDlmm";
import { receiptPositions } from "@/lib/autonomy/receiptStore";
import { mockSuggestedActions } from "@/lib/mock/data";
import type { Position } from "@/lib/types";

function mergePositions(primary: Position[], receiptBacked: Position[]) {
  const seen = new Set<string>();
  const merged: Position[] = [];

  for (const position of [...receiptBacked, ...primary]) {
    const key = position.positionAddress || position.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(position);
  }

  return merged;
}

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet") || "demo-wallet";
  const meteora = getMeteoraDlmmAdapter();
  const positions = await meteora.getUserPositions(wallet);
  const keeperPositions = receiptPositions(25);

  return NextResponse.json({
    positions: mergePositions(positions, keeperPositions),
    suggestedActions: mockSuggestedActions,
  });
}
