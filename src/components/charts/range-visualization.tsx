import { cn } from "@/lib/utils/cn";

export function RangeVisualization({
  lowerBin,
  upperBin,
  activeBin,
}: {
  lowerBin: number;
  upperBin: number;
  activeBin: number | null;
}) {
  const safeActive = activeBin ?? lowerBin;
  const min = Math.min(lowerBin, safeActive) - 20;
  const max = Math.max(upperBin, safeActive) + 20;
  const rangePct = ((lowerBin - min) / (max - min)) * 100;
  const widthPct = ((upperBin - lowerBin) / (max - min)) * 100;
  const activePct = ((safeActive - min) / (max - min)) * 100;
  const inRange = activeBin !== null && activeBin >= lowerBin && activeBin <= upperBin;

  return (
    <div className="space-y-3">
      <div className="relative h-14 rounded-lg border border-[#d9e1ec] bg-[#f8fafc]">
        <div
          className="absolute top-4 h-6 rounded bg-[#bfe4e2]"
          style={{ left: `${rangePct}%`, width: `${Math.max(widthPct, 2)}%` }}
        />
        <div
          className={cn("absolute top-2 h-10 w-1 rounded", inRange ? "bg-[#006d77]" : "bg-[#b42318]")}
          style={{ left: `${activePct}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs text-[#667085]">
        <span>Lower {lowerBin}</span>
        <span className="text-center">Active {activeBin ?? "unknown"}</span>
        <span className="text-right">Upper {upperBin}</span>
      </div>
    </div>
  );
}
