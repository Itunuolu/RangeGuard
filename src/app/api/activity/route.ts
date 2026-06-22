import { NextResponse } from "next/server";

import { receiptEvents } from "@/lib/autonomy/receiptStore";
import { mockEvents } from "@/lib/mock/data";

export async function GET() {
  const events = [...receiptEvents(25), ...mockEvents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return NextResponse.json({ events });
}
