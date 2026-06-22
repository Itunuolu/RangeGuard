import { Badge } from "@/components/ui/badge";
import type { HealthStatus } from "@/lib/types";

export function HealthBadge({ status }: { status: HealthStatus }) {
  if (status === "In range") return <Badge variant="low">In range</Badge>;
  if (status === "Near edge") return <Badge variant="medium">Near edge</Badge>;
  if (status === "Out of range") return <Badge variant="avoid">Out of range</Badge>;
  return <Badge variant="outline">Closed</Badge>;
}
