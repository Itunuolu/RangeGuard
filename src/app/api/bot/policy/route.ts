import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hashBotPolicy } from "@/lib/autonomy/actionHash";
import { getRuntimeBotPolicy } from "@/lib/autonomy/runtime";

const policyPatchSchema = z.object({
  status: z.enum(["Draft", "Paused", "Armed", "Disabled"]).optional(),
  executionMode: z.enum(["SuggestOnly", "WalletConfirmed", "DelegatedGuarded"]).optional(),
  maxPositionSizeUsd: z.number().positive().optional(),
  dailyNotionalLimitUsd: z.number().positive().optional(),
  maxSlippageBps: z.number().int().positive().optional(),
  maxPoolRiskScore: z.number().int().min(1).max(100).optional(),
  minPoolLiquidityUsd: z.number().nonnegative().optional(),
  requireWalletConfirm: z.boolean().optional(),
});

export async function GET() {
  return NextResponse.json({ policy: getRuntimeBotPolicy("user-demo"), persisted: false });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const parsed = policyPatchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid bot policy", issues: parsed.error.flatten() }, { status: 400 });
  }

  const policy = {
    ...getRuntimeBotPolicy("user-demo"),
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json({
    policy: {
      ...policy,
      policyHash: hashBotPolicy(policy),
    },
    persisted: false,
    note: "Mock policy update returned. Persist through BotPolicy once PostgreSQL is connected.",
  });
}
