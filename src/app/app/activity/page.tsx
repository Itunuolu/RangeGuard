"use client";

import { AlertCircle, CheckCircle2, Clock, ExternalLink, RotateCcw } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useActivity } from "@/hooks/use-rangeguard-data";

function iconForEvent(eventType: string) {
  if (eventType === "Error") return AlertCircle;
  if (eventType === "Rebalance suggested") return RotateCcw;
  if (eventType === "Fees claimed" || eventType === "Position created") return CheckCircle2;
  return Clock;
}

function eventSourceLabel(metadata: Record<string, unknown>, hasSignature: boolean) {
  if (metadata.recoveryRequired) return "Recovery required";
  if (metadata.source === "keeper") return "Keeper submitted";
  return hasSignature ? "Wallet signed" : "System event";
}

function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export default function ActivityPage() {
  const { data, isLoading } = useActivity();

  return (
    <div>
      <PageHeader
        eyebrow="Activity"
        title="Monitoring history"
        description="Position creation, scans, suggestions, claims, closures, and errors are recorded for auditability."
      />

      <Card>
        <CardContent className="p-5">
          {isLoading ? (
            <p>Loading activity...</p>
          ) : (
            <div className="space-y-4">
              {(data?.events || []).map((event) => {
                const Icon = iconForEvent(event.eventType);
                return (
                  <div key={event.id} className="grid gap-4 rounded-lg border border-[#e4eaf1] p-4 sm:grid-cols-[40px_1fr_auto]">
                    <div className="grid h-10 w-10 place-items-center rounded-md bg-[#eef8f8] text-[#006d77]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#101828]">{event.eventType}</p>
                        <Badge variant={event.eventType === "Error" ? "avoid" : "outline"}>
                          {eventSourceLabel(event.metadata, Boolean(event.txSignature))}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[#667085]">{event.message}</p>
                      {event.txSignature ? (
                        <a
                          href={explorerTx(event.txSignature)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-[#006d77] hover:text-[#00545c]"
                        >
                          {event.txSignature}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                    <p className="text-sm text-[#667085]">{new Date(event.createdAt).toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
