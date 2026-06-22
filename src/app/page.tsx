import Image from "next/image";
import Link from "next/link";
import { Activity, ArrowRight, Gauge, LineChart, ShieldCheck, SlidersHorizontal, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  { title: "Pool discovery", description: "Compare Meteora DLMM pools by liquidity, volume, volatility, and risk.", icon: Gauge },
  { title: "Risk scoring", description: "See the exact reasons behind every Low, Medium, High, or Avoid label.", icon: ShieldCheck },
  { title: "LP simulator", description: "Preview bins, token ratios, stop loss, take profit, and range tradeoffs.", icon: SlidersHorizontal },
  { title: "Position monitor", description: "Track in-range status, edge distance, fees, PnL estimate, and history.", icon: LineChart },
  { title: "Rebalance suggestions", description: "Get explainable suggestions that still require wallet confirmation.", icon: Activity },
];

export default function Home() {
  return (
    <main className="bg-[#f7f8fb] text-[#101828]">
      <section className="relative min-h-[82vh] overflow-hidden bg-[#071b20]">
        <Image
          src="/rangeguard-hero.png"
          alt="RangeGuard Solana liquidity management dashboard preview"
          fill
          priority
          className="object-cover object-center opacity-80"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,27,32,0.96)_0%,rgba(7,27,32,0.76)_40%,rgba(7,27,32,0.16)_100%)]" />
        <div className="relative mx-auto flex min-h-[82vh] max-w-7xl flex-col justify-between px-4 py-6 sm:px-6 lg:px-8">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-md bg-[#2a9d8f] text-white">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <span className="text-base font-semibold text-white">RangeGuard</span>
            </div>
            <Button asChild variant="secondary">
              <Link href="/app">Open App</Link>
            </Button>
          </header>
          <div className="max-w-3xl py-16 sm:py-20">
            <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-medium text-[#d9f0ef] backdrop-blur">
              <WalletCards className="h-4 w-4" />
              Non-custodial, manual-confirmation-first
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] text-white sm:text-6xl">
              Risk-first liquidity management for Solana LPs
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#d5e4e6]">
              Discover pools, simulate ranges, monitor positions, and rebalance manually with clear risk controls.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/app">
                  Open App
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/app/pools">Explore pools</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto -mt-10 grid max-w-7xl gap-4 px-4 pb-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-5 lg:px-8">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Card key={feature.title} className="relative z-10">
              <CardContent className="p-5">
                <div className="mb-4 grid h-10 w-10 place-items-center rounded-md bg-[#eef8f8] text-[#006d77]">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-base font-semibold">{feature.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[#667085]">{feature.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-[#fde9a2] bg-[#fff9e8] p-6">
          <h2 className="text-lg font-semibold text-[#7a4e00]">Liquidity provision carries risk.</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-[#7a4e00]">
            RangeGuard does not guarantee profit. Risk labels, simulations, APR estimates, and rebalance suggestions are
            decision support only. Every transaction must be reviewed and signed by the connected wallet.
          </p>
        </div>
      </section>
    </main>
  );
}
