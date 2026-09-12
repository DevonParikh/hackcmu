"use client";
// C1 — Where your week goes. One bar per repetitive task, hours/week (estimate), in the business's colour.

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts";

export type TimeSinkRow = { task: string; label?: string; hoursPerWeek: number };

export default function TimeSink({ rows, accent }: { rows: TimeSinkRow[]; accent: string }) {
  const data = [...rows]
    .sort((a, b) => b.hoursPerWeek - a.hoursPerWeek)
    .map(r => ({ ...r, axis: r.label ?? (r.task.length > 40 ? r.task.slice(0, 38) + "…" : r.task) }));
  if (!data.length) return <p className="text-muted">Nothing repetitive found yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={16 + data.length * 52}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 48, top: 4, bottom: 4 }} barCategoryGap={12}>
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis type="category" dataKey="axis" width={190} tick={{ fontSize: 14, fill: "#14213D" }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "rgba(20,33,61,.06)" }} contentStyle={{ borderRadius: 6, border: "1px solid #CAD1CE", fontSize: 14 }}
          formatter={(v) => [`${v} hours a week, estimated`, ""]} labelFormatter={(l) => String(l)} />
        <Bar dataKey="hoursPerWeek" fill={accent} radius={[0, 4, 4, 0]} isAnimationActive animationDuration={500}>
          <LabelList dataKey="hoursPerWeek" position="right" formatter={(v: unknown) => `${v}h`} style={{ fill: "#14213D", fontSize: 14 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
