import { NextRequest, NextResponse } from "next/server";

import { getMeteoraDlmmAdapter } from "@/lib/adapters/meteoraDlmm";
import { getSolanaRpcAdapter } from "@/lib/adapters/solanaRpc";
import { simulateWalletPoolBridge } from "@/lib/protocol/tradeBridge";
import { tierSummary } from "@/lib/protocol/tradingTiers";

function numberParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function walletPublicState(walletAddress: string | null) {
  if (!walletAddress) {
    return {
      walletBalanceSol: null,
      walletTokenAccounts: null,
    };
  }

  const rpc = getSolanaRpcAdapter();

  try {
    const [walletBalanceSol, walletTokenAccounts] = await Promise.all([
      rpc.getWalletBalance(walletAddress),
      rpc.getTokenAccountCount(walletAddress),
    ]);

    return {
      walletBalanceSol,
      walletTokenAccounts,
    };
  } catch {
    return {
      walletBalanceSol: null,
      walletTokenAccounts: null,
    };
  }
}

export async function GET(request: NextRequest) {
  const walletAddress = request.nextUrl.searchParams.get("wallet");
  const poolAddress = request.nextUrl.searchParams.get("pool");
  const investedCapitalUsd = numberParam(request.nextUrl.searchParams.get("capitalUsd"), 2_500);
  const simulatedGrossProfitUsd = request.nextUrl.searchParams.has("grossProfitUsd")
    ? numberParam(request.nextUrl.searchParams.get("grossProfitUsd"), 0)
    : null;
  const horizonDays = numberParam(request.nextUrl.searchParams.get("horizonDays"), 30);

  const meteora = getMeteoraDlmmAdapter();
  const pools = await meteora.listPools();
  const selectedPool =
    (poolAddress ? pools.find((pool) => pool.poolAddress === poolAddress) || (await meteora.getPool(poolAddress)) : null) ||
    pools[0];

  if (!selectedPool) {
    return NextResponse.json({ error: "No liquidity pool is available for bridge simulation." }, { status: 404 });
  }

  const walletState = await walletPublicState(walletAddress);
  const bridge = simulateWalletPoolBridge({
    walletAddress,
    ...walletState,
    pool: selectedPool,
    investedCapitalUsd,
    simulatedGrossProfitUsd,
    horizonDays,
  });

  return NextResponse.json({
    pools,
    bridge,
    tiers: tierSummary(),
  });
}
