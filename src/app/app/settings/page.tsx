"use client";

import { ShieldCheck, SlidersHorizontal } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useMounted } from "@/hooks/use-mounted";
import { clientConfig } from "@/lib/config";
import { usePreferencesStore } from "@/lib/store/preferences";

export default function SettingsPage() {
  const mounted = useMounted();
  const {
    rpcEndpoint,
    slippageBps,
    riskPreference,
    notificationsEnabled,
    acknowledgedRisk,
    setRpcEndpoint,
    setSlippageBps,
    setRiskPreference,
    setNotificationsEnabled,
    setAcknowledgedRisk,
  } = usePreferencesStore();

  const displayRpcEndpoint = mounted ? rpcEndpoint : clientConfig.solanaRpcUrl;
  const displaySlippageBps = mounted ? slippageBps : 50;
  const displayRiskPreference = mounted ? riskPreference : "Balanced";
  const displayNotificationsEnabled = mounted ? notificationsEnabled : false;
  const displayAcknowledgedRisk = mounted ? acknowledgedRisk : false;

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Risk and execution preferences"
        description="These preferences shape previews and monitoring suggestions. They do not grant transaction authority."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader><CardTitle>Application settings</CardTitle></CardHeader>
          <CardContent className="grid gap-5">
            <div className="space-y-2">
              <Label htmlFor="rpc">RPC endpoint</Label>
              <Input id="rpc" value={displayRpcEndpoint} onChange={(event) => setRpcEndpoint(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slippage">Slippage setting (bps)</Label>
              <Input
                id="slippage"
                type="number"
                min="1"
                max="1000"
                value={displaySlippageBps}
                onChange={(event) => setSlippageBps(Number(event.target.value || 0))}
              />
            </div>
            <div className="space-y-2">
              <Label>Risk preference</Label>
              <Select value={displayRiskPreference} onValueChange={(value) => setRiskPreference(value as typeof riskPreference)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Conservative", "Balanced", "Aggressive"].map((value) => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-4 rounded-md border border-[#d9e1ec] p-4">
              <span>
                <span className="block text-sm font-semibold text-[#101828]">Notification preference placeholder</span>
                <span className="mt-1 block text-sm text-[#667085]">Local preference only in this MVP.</span>
              </span>
              <Switch checked={displayNotificationsEnabled} onCheckedChange={setNotificationsEnabled} />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-md border border-[#d9e1ec] p-4">
              <span>
                <span className="block text-sm font-semibold text-[#101828]">Legal/risk disclaimer acknowledgement</span>
                <span className="mt-1 block text-sm text-[#667085]">LP positions can lose value and estimates can be wrong.</span>
              </span>
              <Switch checked={displayAcknowledgedRisk} onCheckedChange={setAcknowledgedRisk} />
            </label>
            <Button className="w-fit">
              <SlidersHorizontal className="h-4 w-4" />
              Preferences saved locally
            </Button>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>Mode and safety</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-[#667085]">Mock mode</span>
              <Badge variant={clientConfig.mockMode ? "medium" : "low"}>
                {clientConfig.mockMode ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-[#667085]">Custody</span>
              <Badge variant="low">None</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-[#667085]">Automatic execution</span>
              <Badge variant="outline">Disabled</Badge>
            </div>
            <div className="rounded-lg border border-[#bfe4e2] bg-[#f5fbfb] p-4">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#006d77]" />
                <p className="text-sm leading-6 text-[#344054]">
                  RangeGuard can prepare previews and suggested actions. Claims, swaps, rebalances, deposits, and
                  withdrawals require wallet review and signature.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
