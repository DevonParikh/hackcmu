"use client";
// C4 — Before / after for the top task. Two bars; the assumption is text under them, not a tooltip.

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList, Cell } from "recharts";

export default function BeforeAfter({ hoursNow, hoursAfter, assumption, accent }:
  { hoursNow: number; hoursAfter: number; assumption: string; accent: string }) {
  const data = [{ name: "Now", hours: hoursNow }, { name: "With the tool", hours: hoursAfter }];
  return (
    <div>
      <ResponsiveContainer width="100%" height={124}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 64, top: 4, bottom: 4 }} barCategoryGap={12}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 14, fill: "#101828" }} axisLine={false} tickLine={false} />
          <Bar dataKey="hours" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={500}>
            <Cell fill="#B9B5AA" /><Cell fill={accent} />
            <LabelList dataKey="hours" position="right" formatter={(v: unknown) => `${v} hrs/wk`} style={{ fill: "#101828", fontSize: 14 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-sm text-muted">Estimate: {assumption}.</p>
    </div>
  );
}
