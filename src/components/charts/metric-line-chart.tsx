"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { TimePoint } from "@/lib/types";

export function MetricLineChart({
  data,
  color = "#006d77",
  height = 220,
  compact,
}: {
  data: TimePoint[];
  color?: string;
  height?: number;
  compact?: boolean;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, left: compact ? 0 : 8, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.22} />
              <stop offset="95%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e4eaf1" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
          {!compact ? <YAxis tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} width={48} /> : null}
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #d9e1ec",
              boxShadow: "0 8px 24px rgba(16, 24, 40, 0.08)",
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={`url(#fill-${color.replace("#", "")})`}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
