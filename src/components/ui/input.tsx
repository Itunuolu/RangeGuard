import * as React from "react";

import { cn } from "@/lib/utils/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-[#c7d2df] bg-white px-3 text-sm text-[#101828] outline-none transition placeholder:text-[#98a2b3] focus:border-[#006d77] focus:ring-2 focus:ring-[#bfe4e2]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
