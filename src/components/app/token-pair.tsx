import { cn } from "@/lib/utils/cn";

const colors = ["bg-[#006d77]", "bg-[#e9c46a]", "bg-[#2a9d8f]", "bg-[#c44536]", "bg-[#264653]"];

export function TokenPair({
  tokenA,
  tokenB,
  size = "md",
}: {
  tokenA: string;
  tokenB: string;
  size?: "sm" | "md";
}) {
  const iconSize = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  const textSize = size === "sm" ? "text-sm" : "text-base";
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        <span className={cn("grid rounded-full text-white ring-2 ring-white place-items-center", iconSize, colors[0])}>
          {tokenA.slice(0, 1)}
        </span>
        <span className={cn("grid rounded-full text-[#101828] ring-2 ring-white place-items-center", iconSize, colors[1])}>
          {tokenB.slice(0, 1)}
        </span>
      </div>
      <div className={cn("font-semibold text-[#101828]", textSize)}>
        {tokenA}/{tokenB}
      </div>
    </div>
  );
}
