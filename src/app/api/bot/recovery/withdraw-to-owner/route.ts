import { NextRequest, NextResponse } from "next/server";

import { submitRecoveryToKeeper, type RecoveryTokenTransferInput } from "@/lib/autonomy/recoverySubmission";

function tokenTransfers(value: unknown): RecoveryTokenTransferInput[] {
  if (!Array.isArray(value)) return [];

  return value.reduce<RecoveryTokenTransferInput[]>((transfers, transfer) => {
    if (!transfer || typeof transfer !== "object") return transfers;
    const candidate = transfer as Record<string, unknown>;
    if (typeof candidate.mint !== "string" || typeof candidate.amount !== "string") return transfers;

    transfers.push({
      mint: candidate.mint,
      amount: candidate.amount,
      tokenProgramId: typeof candidate.tokenProgramId === "string" ? candidate.tokenProgramId : null,
    });

    return transfers;
  }, []);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const transfers = tokenTransfers(body.tokenTransfers);
  const ownerAddress = typeof body.ownerAddress === "string" ? body.ownerAddress : undefined;

  if (!ownerAddress) {
    return NextResponse.json(
      {
        result: {
          mode: "WithdrawToOwner",
          receiptActionId: typeof body.actionId === "string" ? body.actionId : null,
          submitted: false,
          status: "Blocked",
          reasons: ["Withdraw-to-owner requires an explicit owner wallet address."],
        },
      },
      { status: 409 },
    );
  }

  const result = await submitRecoveryToKeeper({
    mode: "WithdrawToOwner",
    actionId: typeof body.actionId === "string" || body.actionId === null ? body.actionId : undefined,
    startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
    walletAddress:
      typeof body.walletAddress === "string" ? body.walletAddress : request.nextUrl.searchParams.get("wallet"),
    ownerAddress,
    tokenTransfers: transfers,
  });
  const accepted = result.submitted || result.status === "Simulated" || result.status === "WithdrawSimulated";

  return NextResponse.json({ result }, { status: accepted ? 202 : 409 });
}
