"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMutation } from "@tanstack/react-query";
import { Save } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveStrategy } from "@/lib/api/client";
import type { PoolTypePreference, RangeWidth, RebalanceTrigger, StrategyRiskLevel } from "@/lib/types";

export default function NewStrategyPage() {
  const { publicKey } = useWallet();
  const [name, setName] = useState("Balanced SOL liquidity guard");
  const [riskLevel, setRiskLevel] = useState<StrategyRiskLevel>("Balanced");
  const [maxPositionSizeUsd, setMaxPositionSizeUsd] = useState(5000);
  const [preferredPoolType, setPreferredPoolType] = useState<PoolTypePreference>("Blue-chip");
  const [minLiquidityUsd, setMinLiquidityUsd] = useState(1_000_000);
  const [minVolume24hUsd, setMinVolume24hUsd] = useState(250_000);
  const [maxRiskScore, setMaxRiskScore] = useState(55);
  const [rangeWidth, setRangeWidth] = useState<RangeWidth>("Medium");
  const [rebalanceTrigger, setRebalanceTrigger] = useState<RebalanceTrigger>("Near edge");
  const [stopLossPct, setStopLossPct] = useState(12);
  const [takeProfitPct, setTakeProfitPct] = useState(25);

  const mutation = useMutation({
    mutationFn: () =>
      saveStrategy({
        walletAddress: publicKey?.toBase58(),
        name,
        riskLevel,
        maxPositionSizeUsd,
        preferredPoolType,
        minLiquidityUsd,
        minVolume24hUsd,
        maxRiskScore,
        rangeWidth,
        rebalanceTrigger,
        stopLossPct,
        takeProfitPct,
      }),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Strategy Builder"
        title="Create a monitoring strategy"
        description="Saved strategies define what RangeGuard should watch for. They do not authorize automated transactions."
      />

      <Card>
        <CardHeader><CardTitle>Risk and pool constraints</CardTitle></CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="strategy-name">Strategy name</Label>
            <Input id="strategy-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Risk level</Label>
            <Select value={riskLevel} onValueChange={(value) => setRiskLevel(value as StrategyRiskLevel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Conservative", "Balanced", "Aggressive"].map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Preferred pool type</Label>
            <Select value={preferredPoolType} onValueChange={(value) => setPreferredPoolType(value as PoolTypePreference)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Stable", "Blue-chip", "Any"].map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-size">Max position size</Label>
            <Input id="max-size" type="number" value={maxPositionSizeUsd} onChange={(event) => setMaxPositionSizeUsd(Number(event.target.value || 0))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min-liquidity">Minimum liquidity</Label>
            <Input id="min-liquidity" type="number" value={minLiquidityUsd} onChange={(event) => setMinLiquidityUsd(Number(event.target.value || 0))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min-volume">Minimum 24h volume</Label>
            <Input id="min-volume" type="number" value={minVolume24hUsd} onChange={(event) => setMinVolume24hUsd(Number(event.target.value || 0))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-risk">Max token risk</Label>
            <Input id="max-risk" type="number" min="1" max="100" value={maxRiskScore} onChange={(event) => setMaxRiskScore(Number(event.target.value || 0))} />
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
          <div className="space-y-2">
            <Label>Rebalance trigger</Label>
            <Select value={rebalanceTrigger} onValueChange={(value) => setRebalanceTrigger(value as RebalanceTrigger)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Out of range", "Near edge", "Fee threshold"].map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="stop-loss">Stop-loss %</Label>
            <Input id="stop-loss" type="number" value={stopLossPct} onChange={(event) => setStopLossPct(Number(event.target.value || 0))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="take-profit">Take-profit %</Label>
            <Input id="take-profit" type="number" value={takeProfitPct} onChange={(event) => setTakeProfitPct(Number(event.target.value || 0))} />
          </div>
          <div className="lg:col-span-2">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              <Save className="h-4 w-4" />
              {mutation.isPending ? "Saving" : "Save strategy"}
            </Button>
            {mutation.data ? (
              <p className="mt-3 text-sm text-[#067647]">
                Strategy saved {mutation.data.persisted ? "to PostgreSQL" : "in mock mode"}.
              </p>
            ) : null}
            {mutation.error ? <p className="mt-3 text-sm text-[#b42318]">Strategy could not be saved.</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
