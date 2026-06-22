"use client";

import type React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowRightLeft,
  Bot,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Settings,
  Shield,
  SlidersHorizontal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RangeGuardWalletButton } from "@/components/app/wallet-button";
import { clientConfig } from "@/lib/config";
import { cn } from "@/lib/utils/cn";

const navItems = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/trading", label: "Trading", icon: ArrowRightLeft },
  { href: "/app/pools", label: "Pools", icon: Gauge },
  { href: "/app/positions", label: "Positions", icon: ListChecks },
  { href: "/app/bot", label: "Bot", icon: Bot },
  { href: "/app/strategies/new", label: "Strategy", icon: SlidersHorizontal },
  { href: "/app/activity", label: "Activity", icon: Activity },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <div className="border-b border-[#d9e1ec] bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <Link href="/app" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-[#006d77] text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-semibold text-[#101828]">RangeGuard</div>
              <div className="text-xs text-[#667085]">Manual-first Solana LP monitor</div>
            </div>
          </Link>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end lg:flex-row lg:items-start">
            <Badge variant={clientConfig.mockMode ? "medium" : "low"}>
              {clientConfig.mockMode ? "MOCK MODE" : "LIVE READ MODE"}
            </Badge>
            <RangeGuardWalletButton />
          </div>
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-6">
        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <nav className="grid gap-1 rounded-lg border border-[#d9e1ec] bg-white p-2 shadow-sm sm:grid-cols-3 lg:grid-cols-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Button
                  key={item.href}
                  asChild
                  variant="ghost"
                  className={cn("justify-start", active && "bg-[#eef8f8] text-[#074f57]")}
                >
                  <Link href={item.href}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
