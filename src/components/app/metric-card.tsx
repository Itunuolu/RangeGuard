import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-[#667085]">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-[#101828]">{value}</p>
          {detail ? <p className="mt-2 text-xs text-[#667085]">{detail}</p> : null}
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#eef8f8] text-[#006d77]">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
