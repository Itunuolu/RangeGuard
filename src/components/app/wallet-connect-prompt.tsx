"use client";

import { ShieldCheck } from "lucide-react";

import { RangeGuardWalletButton } from "@/components/app/wallet-button";
import { Card, CardContent } from "@/components/ui/card";

export function WalletConnectPrompt() {
  return (
    <Card className="border-[#bfe4e2] bg-[#f5fbfb]">
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#d9f0ef] text-[#006d77]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#101828]">Connect a wallet to view your portfolio</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#667085]">
              RangeGuard only reads public wallet data and prepares previews. Any rebalance, claim, or withdrawal
              must be signed by your wallet.
            </p>
          </div>
        </div>
        <RangeGuardWalletButton />
      </CardContent>
    </Card>
  );
}
