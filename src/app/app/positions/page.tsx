"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { AlertTriangle, Eye, HandCoins, RotateCcw, XCircle } from "lucide-react";

import { ActionPreviewDialog } from "@/components/app/action-preview-dialog";
import { HealthBadge } from "@/components/app/health-badge";
import { PageHeader } from "@/components/app/page-header";
import { RiskBadge } from "@/components/app/risk-badge";
import { TokenPair } from "@/components/app/token-pair";
import { WalletConnectPrompt } from "@/components/app/wallet-connect-prompt";
import { RangeVisualization } from "@/components/charts/range-visualization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { usePositions } from "@/hooks/use-rangeguard-data";
import { formatPercent, formatUsd, shortenAddress } from "@/lib/utils/format";

export default function PositionsPage() {
  const { connected, publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const { data, isLoading } = usePositions(walletAddress);

  return (
    <div>
      <PageHeader
        eyebrow="Positions"
        title="Manual LP position monitor"
        description="Track active bins, fee estimates, health, and suggested actions without giving RangeGuard custody."
      />

      {!connected ? <WalletConnectPrompt /> : null}

      <div className="mt-6 grid gap-4">
        {isLoading ? (
          <Card><CardContent className="p-6">Loading positions...</CardContent></Card>
        ) : (
          (data?.positions || []).map((position) => {
            const isKeeperReceiptPosition = position.id.startsWith("position-");
            const recoveryRequired = position.recoveryStatus === "RecoveryRequired";

            return (
            <Card key={position.id}>
              <CardContent className="grid gap-5 p-5 xl:grid-cols-[1.2fr_1fr_1fr_1.2fr] xl:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TokenPair tokenA={position.pool.tokenASymbol} tokenB={position.pool.tokenBSymbol} />
                    {isKeeperReceiptPosition ? <Badge variant="outline">Keeper receipt</Badge> : null}
                    {recoveryRequired ? <Badge variant="avoid">Recovery required</Badge> : null}
                  </div>
                  <p className="mt-2 text-xs text-[#667085]">Pool {shortenAddress(position.pool.poolAddress, 8)}</p>
                  <p className="mt-1 text-xs text-[#667085]">
                    Position {position.positionAddress ? shortenAddress(position.positionAddress, 8) : "Not on-chain yet"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[#667085]">Entry value</p>
                    <p className="mt-1 font-semibold">{formatUsd(position.entryValueUsd)}</p>
                  </div>
                  <div>
                    <p className="text-[#667085]">Current value</p>
                    <p className="mt-1 font-semibold">{formatUsd(position.currentValueUsd)}</p>
                  </div>
                  <div>
                    <p className="text-[#667085]">Est. PnL</p>
                    <p className="mt-1 font-semibold">
                      {formatUsd(position.estimatedPnlUsd)} ({formatPercent(position.estimatedPnlPct)})
                    </p>
                  </div>
                  <div>
                    <p className="text-[#667085]">Fees earned</p>
                    <p className="mt-1 font-semibold">{formatUsd(position.feesEarnedUsd)}</p>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <HealthBadge status={position.healthStatus} />
                    <RiskBadge label={position.pool.riskLabel} />
                  </div>
                  <Progress value={position.healthScore} />
                  <p className="mt-2 text-sm text-[#667085]">Health score {position.healthScore}/100</p>
                  <p className="mt-1 text-sm font-semibold text-[#101828]">Suggested action: {position.suggestedAction}</p>
                  {recoveryRequired ? (
                    <div className="mt-3 flex gap-2 rounded-md border border-[#fecdca] bg-[#fff6f5] p-3 text-xs leading-5 text-[#912018]">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>Phase 1 completed but add-liquidity did not. Retry the original range or withdraw to owner.</p>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4">
                  <RangeVisualization
                    lowerBin={position.lowerBin}
                    upperBin={position.upperBin}
                    activeBin={position.currentActiveBin}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button asChild variant="secondary">
                      <Link href={`/app/positions/${position.id}`}><Eye className="h-4 w-4" />Details</Link>
                    </Button>
                    <ActionPreviewDialog
                      action="Claim fees"
                      title="Claim Fees"
                      description="Claiming fees requires a connected wallet signature. RangeGuard does not claim automatically."
                      disabled
                      preview={[
                        { label: "Position", value: position.id },
                        { label: "Estimated fees", value: formatUsd(position.feesEarnedUsd) },
                        { label: "Required signature", value: "Connected wallet" },
                      ]}
                      trigger={<Button variant="secondary"><HandCoins className="h-4 w-4" />Claim</Button>}
                    />
                    <ActionPreviewDialog
                      action="Rebalance manually"
                      title="Manual Rebalance"
                      description="The preview explains the suggested range. You must review any swap and DLMM transaction before signing."
                      disabled
                      preview={[
                        { label: "Current active bin", value: String(position.currentActiveBin ?? "unknown") },
                        { label: "Existing range", value: `${position.lowerBin} - ${position.upperBin}` },
                        { label: "Required signature", value: "Connected wallet" },
                      ]}
                      trigger={<Button variant="secondary"><RotateCcw className="h-4 w-4" />Rebalance</Button>}
                    />
                    <ActionPreviewDialog
                      action="Close position"
                      title="Close Position"
                      description="Closing withdraws liquidity only after wallet confirmation. This MVP does not execute the withdrawal."
                      disabled
                      preview={[
                        { label: "Current value", value: formatUsd(position.currentValueUsd) },
                        { label: "Fees estimate", value: formatUsd(position.feesEarnedUsd) },
                        { label: "Required signature", value: "Connected wallet" },
                      ]}
                      trigger={<Button variant="secondary"><XCircle className="h-4 w-4" />Close</Button>}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
