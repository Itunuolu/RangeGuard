"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calculator, ShieldAlert } from "lucide-react";

import { ActionPreviewDialog } from "@/components/app/action-preview-dialog";
import { PageHeader } from "@/components/app/page-header";
import { RiskBadge } from "@/components/app/risk-badge";
import { TokenPair } from "@/components/app/token-pair";
import { MetricLineChart } from "@/components/charts/metric-line-chart";
import { RangeVisualization } from "@/components/charts/range-visualization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePool } from "@/hooks/use-rangeguard-data";
import { simulateRange } from "@/lib/risk/simulator";
import type { RangeWidth, StrategyRiskLevel } from "@/lib/types";
import { formatCompactUsd, shortenAddress } from "@/lib/utils/format";

export function PoolDetailClient({ poolAddress }: { poolAddress: string }) {
  const { data, isLoading } = usePool(poolAddress);
  const pool = data?.pool;
  const [depositAmountUsd, setDepositAmountUsd] = useState(2500);
  const [strategy, setStrategy] = useState<StrategyRiskLevel>("Balanced");
  const [rangeWidth, setRangeWidth] = useState<RangeWidth>("Medium");
  const [stopLossPct, setStopLossPct] = useState(12);
  const [takeProfitPct, setTakeProfitPct] = useState(25);
  const [autoCompound, setAutoCompound] = useState(false);

  const simulation = useMemo(() => {
    if (!pool) return null;
    return simulateRange(pool, {
      depositAmountUsd,
      strategy,
      rangeWidth,
      stopLossPct,
      takeProfitPct,
      autoCompound,
    });
  }, [autoCompound, depositAmountUsd, pool, rangeWidth, stopLossPct, strategy, takeProfitPct]);

  if (isLoading || !pool || !simulation) {
    return <Card><CardContent className="p-6">Loading pool...</CardContent></Card>;
  }

  const preview = [
    { label: "Pool", value: `${pool.tokenASymbol}/${pool.tokenBSymbol}` },
    { label: "Required signature", value: "Connected wallet" },
    { label: "Lower bin", value: String(simulation.lowerBin) },
    { label: "Upper bin", value: String(simulation.upperBin) },
    { label: "Mode", value: "Manual position preview" },
    { label: "Execution", value: "Disabled until integration review" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Pool Detail"
        title={`${pool.tokenASymbol}/${pool.tokenBSymbol}`}
        description={pool.riskReasons[0]}
        action={<Button asChild variant="secondary"><Link href="/app/pools"><ArrowLeft className="h-4 w-4" />Back</Link></Button>}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_390px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-4">
              <div className="md:col-span-2 xl:col-span-1">
                <TokenPair tokenA={pool.tokenASymbol} tokenB={pool.tokenBSymbol} />
                <p className="mt-2 text-sm text-[#667085]">{shortenAddress(pool.poolAddress, 10)}</p>
              </div>
              <div>
                <p className="text-xs text-[#667085]">Liquidity</p>
                <p className="mt-1 text-xl font-semibold">{formatCompactUsd(pool.liquidityUsd)}</p>
              </div>
              <div>
                <p className="text-xs text-[#667085]">24h volume</p>
                <p className="mt-1 text-xl font-semibold">{formatCompactUsd(pool.volume24hUsd)}</p>
              </div>
              <div>
                <p className="text-xs text-[#667085]">Active bin</p>
                <p className="mt-1 text-xl font-semibold">{pool.activeBin ?? "Unavailable"}</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Liquidity chart</CardTitle></CardHeader>
              <CardContent><MetricLineChart data={pool.liquidityHistory} color="#006d77" /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Volume chart</CardTitle></CardHeader>
              <CardContent><MetricLineChart data={pool.volumeHistory} color="#c44536" /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Fee history</CardTitle></CardHeader>
              <CardContent><MetricLineChart data={pool.feeHistory} color="#e9c46a" /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Risk explanation</CardTitle></CardHeader>
              <CardContent>
                <div className="mb-4 flex items-center gap-3">
                  <RiskBadge label={pool.riskLabel} />
                  <span className="text-sm font-semibold">{pool.riskScore}/100</span>
                </div>
                <div className="space-y-3">
                  {pool.riskReasons.map((reason) => (
                    <div key={reason} className="flex gap-3 text-sm leading-6 text-[#667085]">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#006d77]" />
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="xl:sticky xl:top-6 xl:h-fit">
          <CardHeader>
            <CardTitle>LP simulator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="deposit">Deposit amount</Label>
              <Input
                id="deposit"
                type="number"
                min="1"
                value={depositAmountUsd}
                onChange={(event) => setDepositAmountUsd(Number(event.target.value || 0))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select value={strategy} onValueChange={(value) => setStrategy(value as StrategyRiskLevel)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Conservative", "Balanced", "Aggressive"].map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Range width</Label>
                <Select value={rangeWidth} onValueChange={(value) => setRangeWidth(value as RangeWidth)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Tight", "Medium", "Wide"].map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stop-loss">Stop loss %</Label>
                <Input id="stop-loss" type="number" value={stopLossPct} onChange={(event) => setStopLossPct(Number(event.target.value || 0))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="take-profit">Take profit %</Label>
                <Input id="take-profit" type="number" value={takeProfitPct} onChange={(event) => setTakeProfitPct(Number(event.target.value || 0))} />
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-md border border-[#d9e1ec] p-3">
              <span className="text-sm font-medium text-[#344054]">Auto-compound future preference</span>
              <Switch checked={autoCompound} onCheckedChange={setAutoCompound} />
            </label>

            <RangeVisualization lowerBin={simulation.lowerBin} upperBin={simulation.upperBin} activeBin={pool.activeBin} />

            <div className="rounded-lg border border-[#d9e1ec] bg-[#f8fafc] p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {simulation.previewItems.map((item) => (
                  <div key={item.label}>
                    <p className="text-[#667085]">{item.label}</p>
                    <p className="mt-1 font-semibold text-[#101828]">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-sm leading-6 text-[#667085]">{simulation.rangeHealth}</p>
            <p className="rounded-lg border border-[#fde9a2] bg-[#fff9e8] p-3 text-sm leading-6 text-[#7a4e00]">
              {simulation.riskWarning}
            </p>

            <ActionPreviewDialog
              action="Create manual position"
              title="Create Manual Position"
              description="This MVP shows the transaction requirements before signing. Real DLMM transaction support is disabled until integration review."
              preview={preview}
              disabled
              trigger={
                <Button className="w-full">
                  <Calculator className="h-4 w-4" />
                  Create Manual Position
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
