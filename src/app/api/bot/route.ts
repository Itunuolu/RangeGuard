import { NextRequest, NextResponse } from "next/server";

import { getBotControlPlane } from "@/lib/autonomy/runtime";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");

  return NextResponse.json(getBotControlPlane(wallet));
}
