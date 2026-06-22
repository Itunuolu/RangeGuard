import { PoolDetailClient } from "./pool-detail-client";
import { mockPools } from "@/lib/mock/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return mockPools.map((pool) => ({
    poolAddress: pool.poolAddress,
  }));
}

export default async function PoolDetailPage({ params }: { params: Promise<{ poolAddress: string }> }) {
  const { poolAddress } = await params;
  return <PoolDetailClient poolAddress={decodeURIComponent(poolAddress)} />;
}
