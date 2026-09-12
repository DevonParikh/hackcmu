"use client";
// C4 — Before / after for the top task. Two bars, and the assumption written under them, not in a tooltip.

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList, Cell } from "recharts";

export default function BeforeAfter({ task, hoursNow, hoursAfter, assumption }:
  { task: string; hoursNow: number; hoursAfter: number; assumption: string }) {
  const data = [{ name: "Now", hours: hoursNow }, { name: "With the tool", hours: hoursAfter }];
  return (
    <div>
      <p className="mb-2 text-sm text-muted">{task}</p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 44, top: 4, bottom: 4 }} barCategoryGap={12}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 13, fill: "#14213D" }} axisLine={false} tickLine={false} />
          <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
            <Cell fill="#5F6B72" /><Cell fill="#2E7D5B" />
            <LabelList dataKey="hours" position="right" formatter={(v: unknown) => `${v} hrs/wk`} style={{ fill: "#14213D", fontSize: 13 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-sm text-muted">Estimate: {assumption}.</p>
    </div>
  );
}
