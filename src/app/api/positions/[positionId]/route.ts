import { NextRequest, NextResponse } from "next/server";

import { receiptEvents, receiptPositions } from "@/lib/autonomy/receiptStore";
import { getPositionById, mockEvents, mockSuggestedActions } from "@/lib/mock/data";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ positionId: string }> }) {
  const { positionId } = await params;
  const position = getPositionById(positionId) || receiptPositions(25).find((candidate) => candidate.id === positionId);

  if (!position) {
    return NextResponse.json({ error: "Position not found" }, { status: 404 });
  }
  const events = [...receiptEvents(25), ...mockEvents]
    .filter((event) => event.positionId === positionId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({
    position,
    events,
    suggestedAction: mockSuggestedActions.find((action) => action.positionId === positionId) || null,
  });
}
