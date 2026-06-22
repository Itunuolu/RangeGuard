"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpDown, Search } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { RiskBadge } from "@/components/app/risk-badge";
import { TokenPair } from "@/components/app/token-pair";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePools } from "@/hooks/use-rangeguard-data";
import type { Pool, RiskLabel } from "@/lib/types";
import { formatCompactUsd, shortenAddress } from "@/lib/utils/format";

type SortMode = "Recommended" | "Fee APR" | "Volume" | "Liquidity" | "Risk score";
type RiskFilter = "All" | RiskLabel;

function sortPools(pools: Pool[], sortMode: SortMode) {
  return [...pools].sort((a, b) => {
    if (sortMode === "Fee APR") return b.feeApr - a.feeApr;
    if (sortMode === "Volume") return b.volume24hUsd - a.volume24hUsd;
    if (sortMode === "Liquidity") return b.liquidityUsd - a.liquidityUsd;
    if (sortMode === "Risk score") return a.riskScore - b.riskScore;
    return a.riskScore - b.riskScore || b.volume24hUsd - a.volume24hUsd;
  });
}

export default function PoolsPage() {
  const { data, isLoading } = usePools();
  const [stableOnly, setStableOnly] = useState(false);
  const [minLiquidity, setMinLiquidity] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskFilter>("All");
  const [sortMode, setSortMode] = useState<SortMode>("Recommended");

  const pools = useMemo(() => {
    const minLiquidityNumber = Number(minLiquidity || 0);
    const minVolumeNumber = Number(minVolume || 0);
    const filtered = (data?.pools || []).filter((pool) => {
      if (stableOnly && pool.poolType !== "Stable") return false;
      if (minLiquidityNumber && pool.liquidityUsd < minLiquidityNumber) return false;
      if (minVolumeNumber && pool.volume24hUsd < minVolumeNumber) return false;
      if (riskLevel !== "All" && pool.riskLabel !== riskLevel) return false;
      return true;
    });
    return sortPools(filtered, sortMode);
  }, [data?.pools, minLiquidity, minVolume, riskLevel, sortMode, stableOnly]);

  return (
    <div>
      <PageHeader
        eyebrow="Pool Explorer"
        title="Meteora DLMM pools"
        description="Compare pools by transparent risk, activity, and liquidity before opening a manual LP preview."
      />

      <Card>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr]">
          <label className="flex items-center justify-between gap-3 rounded-md border border-[#d9e1ec] px-3 py-2">
            <span className="text-sm font-medium text-[#344054]">Stable pairs only</span>
            <Switch checked={stableOnly} onCheckedChange={setStableOnly} />
          </label>
          <div className="space-y-2">
            <Label htmlFor="min-liquidity">Minimum liquidity</Label>
            <Input
              id="min-liquidity"
              type="number"
              min="0"
              placeholder="1000000"
              value={minLiquidity}
              onChange={(event) => setMinLiquidity(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min-volume">Minimum volume</Label>
            <Input
              id="min-volume"
              type="number"
              min="0"
              placeholder="250000"
              value={minVolume}
              onChange={(event) => setMinVolume(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Risk level</Label>
            <Select value={riskLevel} onValueChange={(value) => setRiskLevel(value as RiskFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["All", "Low", "Medium", "High", "Avoid"].map((level) => (
                  <SelectItem key={level} value={level}>{level}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Sort by</Label>
            <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Recommended", "Fee APR", "Volume", "Liquidity", "Risk score"].map((mode) => (
                  <SelectItem key={mode} value={mode}>{mode}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-4">
        {isLoading ? (
          <Card><CardContent className="p-6">Loading pools...</CardContent></Card>
        ) : pools.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 p-6 text-[#667085]">
              <Search className="h-5 w-5" />
              No pools match the current filters.
            </CardContent>
          </Card>
        ) : (
          pools.map((pool) => (
            <Card key={pool.poolAddress}>
              <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_120px] lg:items-center">
                <div>
                  <TokenPair tokenA={pool.tokenASymbol} tokenB={pool.tokenBSymbol} />
                  <p className="mt-2 text-xs text-[#667085]">{pool.protocol}</p>
                  <p className="mt-1 text-xs text-[#667085]">{shortenAddress(pool.poolAddress, 8)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#667085]">Liquidity</p>
                  <p className="mt-1 font-semibold">{formatCompactUsd(pool.liquidityUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#667085]">24h volume</p>
                  <p className="mt-1 font-semibold">{formatCompactUsd(pool.volume24hUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#667085]">Est. fee APR</p>
                  <p className="mt-1 font-semibold">{pool.feeApr.toFixed(1)}%</p>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <RiskBadge label={pool.riskLabel} />
                    <span className="text-sm font-semibold">{pool.riskScore}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#667085]">{pool.riskReasons[0]}</p>
                  <p className="mt-1 text-xs text-[#667085]">Volatility {pool.volatilityScore}/100</p>
                </div>
                <Button asChild variant="secondary">
                  <Link href={`/app/pools/${encodeURIComponent(pool.poolAddress)}`}>
                    Details
                    <ArrowUpDown className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
