"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowRightLeft,
  Calculator,
  CheckCircle2,
  DatabaseZap,
  WalletCards,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { RiskBadge } from "@/components/app/risk-badge";
import { TokenPair } from "@/components/app/token-pair";
import { WalletConnectPrompt } from "@/components/app/wallet-connect-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTradingBridge } from "@/hooks/use-rangeguard-data";
import { formatPercent, formatUsd, shortenAddress } from "@/lib/utils/format";

function pct(value: number) {
  return `${Number(value.toFixed(2))}%`;
}

export default function TradingBridgePage() {
  const { connected, publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const [poolAddress, setPoolAddress] = useState<string | undefined>();
  const [capitalUsd, setCapitalUsd] = useState(2_500);
  const [grossProfitUsd, setGrossProfitUsd] = useState(180);
  const [horizonDays, setHorizonDays] = useState(30);
  const { data, isLoading } = useTradingBridge({
    walletAddress,
    poolAddress,
    capitalUsd,
    grossProfitUsd,
    horizonDays,
  });
  const bridge = data?.bridge;
  const selectedPoolAddress = poolAddress || bridge?.pool.poolAddress;
  const tierProgress = useMemo(() => {
    if (!bridge?.tradingTier) return 0;
    if (bridge.tradingTier.id === "TIER 3") return 100;
    const maxCapitalUsd = bridge.tradingTier.maxCapitalUsd || bridge.investedCapitalUsd;
    return Math.max(0, Math.min(100, (bridge.investedCapitalUsd / maxCapitalUsd) * 100));
  }, [bridge]);

  return (
    <div>
      <PageHeader
        eyebrow="Trading Bridge"
        title="Wallet-to-pool trade simulator"
        description="Connect a wallet, select a liquidity pool, simulate trade profit, and apply the capital-based profit deduction before any wallet-confirmed execution."
      />

      {!connected ? <WalletConnectPrompt /> : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <Card className="xl:sticky xl:top-6 xl:h-fit">
          <CardHeader>
            <CardTitle>Trade inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-[#d9e1ec] bg-[#f8fafc] p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-[#101828]">
                <WalletCards className="h-4 w-4 text-[#006d77]" />
                Wallet
              </div>
              <p className="mt-2 text-[#667085]">
                {walletAddress ? shortenAddress(walletAddress, 7) : "No wallet connected"}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Liquidity pool</Label>
              <Select value={selectedPoolAddress} onValueChange={setPoolAddress}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a pool" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.pools || []).map((pool) => (
                    <SelectItem key={pool.poolAddress} value={pool.poolAddress}>
                      {pool.tokenASymbol}/{pool.tokenBSymbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-2">
                <Label htmlFor="capital">Invested capital</Label>
                <Input
                  id="capital"
                  min="0"
                  type="number"
                  value={capitalUsd}
                  onChange={(event) => setCapitalUsd(Number(event.target.value || 0))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profit">Simulated gross profit</Label>
                <Input
                  id="profit"
                  type="number"
                  value={grossProfitUsd}
                  onChange={(event) => setGrossProfitUsd(Number(event.target.value || 0))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="horizon">Simulation window</Label>
              <Input
                id="horizon"
                min="1"
                max="90"
                type="number"
                value={horizonDays}
                onChange={(event) => setHorizonDays(Number(event.target.value || 30))}
              />
            </div>

            <Button disabled={!bridge?.canPrepareTrade} className="w-full">
              <ArrowRightLeft className="h-4 w-4" />
              Prepare wallet-confirmed trade
            </Button>
          </CardContent>
        </Card>

        {isLoading || !bridge ? (
          <Card>
            <CardContent className="p-6">Loading trading bridge...</CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-[#667085]">Capital tier</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-2xl font-semibold text-[#101828]">{bridge.tradingTier?.id || "No tier"}</p>
                    <Badge variant={bridge.tradingTier ? "low" : "avoid"}>{bridge.tradingTier?.label || "Min $10"}</Badge>
                  </div>
                  <Progress value={tierProgress} className="mt-4" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-[#667085]">Profit deduction</p>
                  <p className="mt-3 text-2xl font-semibold text-[#101828]">{formatUsd(bridge.profitDeductionUsd)}</p>
                  <p className="mt-2 text-xs text-[#667085]">{pct(bridge.profitDeductionPct)} of positive profit</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-[#667085]">Net simulated profit</p>
                  <p className="mt-3 text-2xl font-semibold text-[#101828]">{formatUsd(bridge.simulatedNetProfitUsd)}</p>
                  <p className="mt-2 text-xs text-[#667085]">After profit deduction</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-[#667085]">Bridge status</p>
                  <p className="mt-3 text-2xl font-semibold text-[#101828]">
                    {bridge.canPrepareTrade ? "Ready" : "Blocked"}
                  </p>
                  <p className="mt-2 text-xs text-[#667085]">Wallet, pool, and tier checks</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Wallet-pool synchronization</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1fr_330px]">
                <div className="space-y-3">
                  {bridge.syncChecks.map((check) => (
                    <div key={check.id} className="flex gap-3 rounded-md border border-[#e4eaf1] p-3 text-sm">
                      {check.passed ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#067647]" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#b42318]" />
                      )}
                      <div>
                        <p className="font-semibold text-[#101828]">{check.label}</p>
                        <p className="mt-1 leading-5 text-[#667085]">{check.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-[#d9e1ec] bg-[#f8fafc] p-4">
                  <div className="flex items-center gap-3">
                    <DatabaseZap className="h-5 w-5 text-[#006d77]" />
                    <div>
                      <p className="font-semibold text-[#101828]">Route plan</p>
                      <p className="text-xs text-[#667085]">Preview-first execution sequence</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {bridge.routePlan.map((step, index) => (
                      <div key={step} className="flex gap-3 text-sm text-[#344054]">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white font-semibold text-[#006d77]">
                          {index + 1}
                        </span>
                        <span className="leading-6">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[1fr_370px]">
              <Card>
                <CardHeader>
                  <CardTitle>Selected pool and trade simulation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-[1fr_160px_160px] md:items-center">
                    <div>
                      <TokenPair tokenA={bridge.pool.tokenASymbol} tokenB={bridge.pool.tokenBSymbol} />
                      <p className="mt-2 text-sm text-[#667085]">{shortenAddress(bridge.pool.poolAddress, 10)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#667085]">Risk</p>
                      <div className="mt-2 flex items-center gap-2">
                        <RiskBadge label={bridge.pool.riskLabel} />
                        <span className="text-sm font-semibold">{bridge.pool.riskScore}/100</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-[#667085]">Projected fee APR</p>
                      <p className="mt-1 font-semibold">{formatPercent(bridge.projectedFeeApr)}</p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      ["Gross profit", formatUsd(bridge.simulatedGrossProfitUsd)],
                      ["Profit deduction", formatUsd(bridge.profitDeductionUsd)],
                      ["Net profit", formatUsd(bridge.simulatedNetProfitUsd)],
                      ["Slippage", `${bridge.estimatedSlippageBps} bps`],
                      ["Price impact", pct(bridge.estimatedPriceImpactPct)],
                      ["Liquidity used", pct(bridge.liquidityUtilizationPct)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border border-[#e4eaf1] p-3 text-sm">
                        <p className="text-[#667085]">{label}</p>
                        <p className="mt-1 font-semibold text-[#101828]">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-[#bfe4e2] bg-[#f5fbfb] p-4">
                    <div className="flex gap-3">
                      <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-[#006d77]" />
                      <p className="text-sm leading-6 text-[#344054]">
                        Simulated pool entry uses {Math.round(bridge.tokenARatio * 100)}% {bridge.pool.tokenASymbol} and{" "}
                        {Math.round(bridge.tokenBRatio * 100)}% {bridge.pool.tokenBSymbol}. The tier deduction applies
                        only to positive profit, never to the invested capital.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tier rules</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {(data?.tiers || []).map((tier) => (
                    <div
                      key={tier.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-[#e4eaf1] p-3"
                    >
                      <div>
                        <p className="font-semibold text-[#101828]">{tier.id}</p>
                        <p className="mt-1 text-[#667085]">{tier.label}</p>
                      </div>
                      <Badge variant={bridge.tradingTier?.id === tier.id ? "low" : "outline"}>{tier.deductionLabel}</Badge>
                    </div>
                  ))}
                  <div className="rounded-md border border-[#e4eaf1] p-3">
                    <p className="font-semibold text-[#101828]">Wallet</p>
                    <p className="mt-1 text-[#667085]">
                      {bridge.walletAddress ? shortenAddress(bridge.walletAddress, 6) : "Connect a wallet"}
                    </p>
                  </div>
                  <div className="rounded-md border border-[#e4eaf1] p-3">
                    <p className="font-semibold text-[#101828]">Current trade</p>
                    <p className="mt-1 text-[#667085]">
                      {formatUsd(bridge.investedCapitalUsd)} capital, {formatUsd(bridge.simulatedGrossProfitUsd)} gross profit.
                    </p>
                  </div>
                  <div className="rounded-md border border-[#e4eaf1] p-3">
                    <p className="font-semibold text-[#101828]">Pool</p>
                    <p className="mt-1 text-[#667085]">
                      Active bin {bridge.pool.activeBin ?? "unavailable"} with {pct(bridge.liquidityUtilizationPct)} liquidity use.
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#bfe4e2] bg-[#f5fbfb] p-4">
                    <p className="font-semibold text-[#101828]">{bridge.canPrepareTrade ? "Ready to prepare" : "Blocked"}</p>
                    <p className="mt-1 leading-6 text-[#667085]">
                      The bridge checks wallet state, pool state, and tier eligibility before preparing the trade.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
