"use client";

import Link from "next/link";
import { ArrowLeft, AlertTriangle, HandCoins, RotateCcw, XCircle } from "lucide-react";

import { ActionPreviewDialog } from "@/components/app/action-preview-dialog";
import { HealthBadge } from "@/components/app/health-badge";
import { PageHeader } from "@/components/app/page-header";
import { TokenPair } from "@/components/app/token-pair";
import { MetricLineChart } from "@/components/charts/metric-line-chart";
import { RangeVisualization } from "@/components/charts/range-visualization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePosition } from "@/hooks/use-rangeguard-data";
import { formatPercent, formatUsd, shortenAddress } from "@/lib/utils/format";

export function PositionDetailClient({ positionId }: { positionId: string }) {
  const { data, isLoading } = usePosition(positionId);
  const position = data?.position;
  const suggestedAction = data?.suggestedAction;

  if (isLoading || !position) {
    return <Card><CardContent className="p-6">Loading position...</CardContent></Card>;
  }

  const outOfRange = position.healthStatus === "Out of range";

  return (
    <div>
      <PageHeader
        eyebrow="Position Detail"
        title={`${position.pool.tokenASymbol}/${position.pool.tokenBSymbol}`}
        description={`Position ${position.positionAddress ? shortenAddress(position.positionAddress, 10) : position.id}`}
        action={<Button asChild variant="secondary"><Link href="/app/positions"><ArrowLeft className="h-4 w-4" />Back</Link></Button>}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_390px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <TokenPair tokenA={position.pool.tokenASymbol} tokenB={position.pool.tokenBSymbol} />
                <p className="mt-2 text-sm text-[#667085]">{shortenAddress(position.pool.poolAddress, 10)}</p>
              </div>
              <div>
                <p className="text-xs text-[#667085]">Current value</p>
                <p className="mt-1 text-xl font-semibold">{formatUsd(position.currentValueUsd)}</p>
              </div>
              <div>
                <p className="text-xs text-[#667085]">PnL estimate</p>
                <p className="mt-1 text-xl font-semibold">
                  {formatUsd(position.estimatedPnlUsd)} ({formatPercent(position.estimatedPnlPct)})
                </p>
              </div>
              <div>
                <p className="text-xs text-[#667085]">Fees earned</p>
                <p className="mt-1 text-xl font-semibold">{formatUsd(position.feesEarnedUsd)}</p>
              </div>
            </CardContent>
          </Card>

          {outOfRange ? (
            <Card className="border-[#fde9a2] bg-[#fff9e8]">
              <CardContent className="flex gap-4 p-5 text-[#7a4e00]">
                <AlertTriangle className="mt-1 h-5 w-5 shrink-0" />
                <div>
                  <h2 className="font-semibold">This position is outside its earning range.</h2>
                  <p className="mt-2 text-sm leading-6">
                    Suggested action: rebalance around current active bin. Current active bin{" "}
                    {position.currentActiveBin}, existing range {position.lowerBin} to {position.upperBin}.
                  </p>
                  {suggestedAction ? (
                    <p className="mt-2 text-sm leading-6">
                      Proposed range {String(suggestedAction.metadata.proposedLowerBin)} to{" "}
                      {String(suggestedAction.metadata.proposedUpperBin)}. {String(suggestedAction.metadata.estimatedSwap)}{" "}
                      {String(suggestedAction.metadata.slippageWarning)}
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>Current range</CardTitle></CardHeader>
            <CardContent>
              <RangeVisualization
                lowerBin={position.lowerBin}
                upperBin={position.upperBin}
                activeBin={position.currentActiveBin}
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Health timeline</CardTitle></CardHeader>
              <CardContent><MetricLineChart data={position.healthTimeline} color="#006d77" height={190} compact /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Fee timeline</CardTitle></CardHeader>
              <CardContent><MetricLineChart data={position.feeTimeline} color="#e9c46a" height={190} compact /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>PnL estimate</CardTitle></CardHeader>
              <CardContent><MetricLineChart data={position.pnlTimeline} color="#c44536" height={190} compact /></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Activity history</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {(data?.events || []).map((event) => (
                <div key={event.id} className="rounded-lg border border-[#e4eaf1] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[#101828]">{event.eventType}</p>
                    <p className="text-xs text-[#667085]">{new Date(event.createdAt).toLocaleDateString()}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#667085]">{event.message}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="xl:sticky xl:top-6 xl:h-fit">
          <CardHeader><CardTitle>Suggested action</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <HealthBadge status={position.healthStatus} />
              <span className="text-sm font-semibold">{position.healthScore}/100</span>
            </div>
            <p className="text-sm leading-6 text-[#667085]">
              {suggestedAction?.reason || `Current recommendation: ${position.suggestedAction}.`}
            </p>
            <div className="rounded-lg border border-[#d9e1ec] bg-[#f8fafc] p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-[#667085]">Lower bin</span>
                <span className="font-semibold">{position.lowerBin}</span>
              </div>
              <div className="mt-3 flex justify-between gap-3">
                <span className="text-[#667085]">Upper bin</span>
                <span className="font-semibold">{position.upperBin}</span>
              </div>
              <div className="mt-3 flex justify-between gap-3">
                <span className="text-[#667085]">Current active bin</span>
                <span className="font-semibold">{position.currentActiveBin ?? "unknown"}</span>
              </div>
            </div>
            <div className="grid gap-3">
              <ActionPreviewDialog
                action="Claim fees"
                title="Claim Fees"
                description="Claiming fees requires a wallet signature. This MVP does not submit a transaction."
                disabled
                preview={[
                  { label: "Estimated fees", value: formatUsd(position.feesEarnedUsd) },
                  { label: "Required signature", value: "Connected wallet" },
                ]}
                trigger={<Button variant="secondary" className="w-full"><HandCoins className="h-4 w-4" />Claim fees</Button>}
              />
              <ActionPreviewDialog
                action="Rebalance manually"
                title="Manual Rebalance"
                description="Rebalance suggestions explain the range change and swap requirement before any wallet action."
                disabled
                preview={[
                  { label: "Existing range", value: `${position.lowerBin} - ${position.upperBin}` },
                  { label: "Proposed range", value: suggestedAction ? `${String(suggestedAction.metadata.proposedLowerBin)} - ${String(suggestedAction.metadata.proposedUpperBin)}` : "Review current bin" },
                  { label: "Slippage warning", value: "Use reviewed Jupiter quote" },
                ]}
                trigger={<Button className="w-full"><RotateCcw className="h-4 w-4" />Rebalance manually</Button>}
              />
              <ActionPreviewDialog
                action="Close position"
                title="Close Position"
                description="Withdrawals must be confirmed in wallet. RangeGuard will not move funds automatically."
                disabled
                preview={[
                  { label: "Current value", value: formatUsd(position.currentValueUsd) },
                  { label: "Estimated PnL", value: formatUsd(position.estimatedPnlUsd) },
                ]}
                trigger={<Button variant="danger" className="w-full"><XCircle className="h-4 w-4" />Close position</Button>}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
