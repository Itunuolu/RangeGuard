import { NextRequest, NextResponse } from "next/server";

import { submitRecoveryToKeeper } from "@/lib/autonomy/recoverySubmission";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const result = await submitRecoveryToKeeper({
    mode: "RetryAddLiquidity",
    actionId: typeof body.actionId === "string" || body.actionId === null ? body.actionId : undefined,
    startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
    walletAddress:
      typeof body.walletAddress === "string" ? body.walletAddress : request.nextUrl.searchParams.get("wallet"),
  });
  const accepted = result.submitted || result.status === "Simulated" || result.status === "RetrySimulated";

  return NextResponse.json({ result }, { status: accepted ? 202 : 409 });
}
