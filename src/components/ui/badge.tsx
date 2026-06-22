import * as React from "react";

import { cn } from "@/lib/utils/cn";

const variants = {
  default: "bg-[#eef3f7] text-[#344054]",
  low: "bg-[#e7f8ef] text-[#067647]",
  medium: "bg-[#fff7df] text-[#8a5a00]",
  high: "bg-[#fff1e7] text-[#b54708]",
  avoid: "bg-[#ffeceb] text-[#b42318]",
  outline: "border border-[#c7d2df] bg-white text-[#344054]",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold leading-none",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
