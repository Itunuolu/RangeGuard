import { Badge } from "@/components/ui/badge";
import type { RiskLabel } from "@/lib/types";

export function RiskBadge({ label }: { label: RiskLabel }) {
  const variant = label === "Low" ? "low" : label === "Medium" ? "medium" : label === "High" ? "high" : "avoid";
  return <Badge variant={variant}>{label}</Badge>;
}
