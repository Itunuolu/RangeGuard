import { NextRequest, NextResponse } from "next/server";

import { submitGuardedAutonomyAction } from "@/lib/autonomy/executor";
import { findBotAction } from "@/lib/autonomy/runtime";

export async function POST(request: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await params;
  const body = await request.json().catch(() => ({}));
  const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress : request.nextUrl.searchParams.get("wallet");
  const { controlPlane, action } = findBotAction(actionId, walletAddress);

  if (!action) {
    return NextResponse.json({ error: "Bot action not found" }, { status: 404 });
  }

  const result = await submitGuardedAutonomyAction(controlPlane.policy, action, { walletAddress });
  const accepted =
    result.submitted || result.status === "AcceptedDryRun" || result.status === "Simulated";

  return NextResponse.json(
    { result },
    {
      status: accepted ? 202 : 409,
    },
  );
}
