import { NextResponse } from "next/server";

import { serverConfig } from "@/lib/config";

export async function GET() {
  return NextResponse.json({
    mockMode: serverConfig.mockMode,
    rpcEndpoint: serverConfig.solanaRpcUrl,
    manualConfirmationRequired: true,
  });
}
