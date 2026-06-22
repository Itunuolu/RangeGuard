import { PositionDetailClient } from "./position-detail-client";
import { mockPositions } from "@/lib/mock/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return mockPositions.map((position) => ({
    positionId: position.id,
  }));
}

export default async function PositionDetailPage({ params }: { params: Promise<{ positionId: string }> }) {
  const { positionId } = await params;
  return <PositionDetailClient positionId={positionId} />;
}
