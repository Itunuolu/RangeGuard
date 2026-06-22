"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Activity, ArrowRight, Coins, HandCoins, LineChart, ListChecks, Sparkles } from "lucide-react";

import { MetricCard } from "@/components/app/metric-card";
import { PageHeader } from "@/components/app/page-header";
import { RiskBadge } from "@/components/app/risk-badge";
import { TokenPair } from "@/components/app/token-pair";
import { WalletConnectPrompt } from "@/components/app/wallet-connect-prompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useDashboard } from "@/hooks/use-rangeguard-data";
import { formatCompactUsd, formatPercent, formatUsd, shortenAddress } from "@/lib/utils/format";

export default function DashboardPage() {
  const { connected, publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const { data, isLoading } = useDashboard(walletAddress);

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard"
        title="Portfolio risk overview"
        description="Read-heavy monitoring for Solana LPs. Suggestions explain their reason and every transaction remains wallet-confirmed."
        action={<Button asChild><Link href="/app/pools">Find pools</Link></Button>}
      />

      {!connected ? <WalletConnectPrompt /> : null}

      <div className="mt-6 rounded-lg border border-[#d9e1ec] bg-white p-4 text-sm text-[#667085]">
        Connected wallet:{" "}
        <span className="font-semibold text-[#101828]">
          {walletAddress ? shortenAddress(walletAddress, 6) : "No wallet connected"}
        </span>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Portfolio value"
          value={isLoading ? "Loading" : formatUsd(data?.summary.portfolioValueUsd || 0)}
          detail="Current LP estimate"
          icon={Coins}
        />
        <MetricCard
          label="Active positions"
          value={String(data?.summary.activePositions || 0)}
          detail="Open monitored ranges"
          icon={ListChecks}
        />
        <MetricCard
          label="Estimated fees"
          value={formatUsd(data?.summary.estimatedFeesUsd || 0)}
          detail="Unclaimed fee estimate"
          icon={HandCoins}
        />
        <MetricCard
          label="Estimated PnL"
          value={formatUsd(data?.summary.estimatedPnlUsd || 0)}
          detail={formatPercent(data?.summary.estimatedPnlPct || 0)}
          icon={LineChart}
        />
        <MetricCard
          label="Suggested actions"
          value={String(data?.summary.suggestedActions || 0)}
          detail="Manual review required"
          icon={Sparkles}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Top recommended pools</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data?.topPools || []).map((pool) => (
              <Link
                href={`/app/pools/${encodeURIComponent(pool.poolAddress)}`}
                key={pool.poolAddress}
                className="grid gap-4 rounded-lg border border-[#e4eaf1] p-4 transition hover:border-[#006d77] md:grid-cols-[1fr_120px_120px_120px]"
              >
                <div>
                  <TokenPair tokenA={pool.tokenASymbol} tokenB={pool.tokenBSymbol} />
                  <p className="mt-2 text-sm leading-6 text-[#667085]">{pool.riskReasons[0]}</p>
                </div>
                <div>
                  <p className="text-xs text-[#667085]">Liquidity</p>
                  <p className="mt-1 font-semibold">{formatCompactUsd(pool.liquidityUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#667085]">24h volume</p>
                  <p className="mt-1 font-semibold">{formatCompactUsd(pool.volume24hUsd)}</p>
                </div>
                <div className="space-y-2">
                  <RiskBadge label={pool.riskLabel} />
                  <Progress value={100 - pool.riskScore} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data?.recentActivity || []).map((event) => (
              <div key={event.id} className="flex gap-3">
                <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#eef8f8] text-[#006d77]">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#101828]">{event.eventType}</p>
                  <p className="mt-1 text-sm leading-6 text-[#667085]">{event.message}</p>
                </div>
              </div>
            ))}
            <Button asChild variant="secondary" className="w-full">
              <Link href="/app/activity">
                View activity
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
