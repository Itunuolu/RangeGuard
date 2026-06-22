import { NextRequest, NextResponse } from "next/server";

import { previewAutonomyExecution } from "@/lib/autonomy/executor";
import { findBotAction } from "@/lib/autonomy/runtime";

export async function POST(request: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await params;
  const wallet = request.nextUrl.searchParams.get("wallet");
  const { controlPlane, action } = findBotAction(actionId, wallet);

  if (!action) {
    return NextResponse.json({ error: "Bot action not found" }, { status: 404 });
  }

  return NextResponse.json({
    preview: previewAutonomyExecution(controlPlane.policy, action),
  });
}
