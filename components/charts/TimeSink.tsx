"use client";
// C1 — Where your week goes. One bar per repetitive task, hours/week (estimate).

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts";

export type TimeSinkRow = { task: string; hoursPerWeek: number; confidence: "low" | "medium" | "high" };

export default function TimeSink({ rows }: { rows: TimeSinkRow[] }) {
  const data = [...rows]
    .sort((a, b) => b.hoursPerWeek - a.hoursPerWeek)
    .map(r => ({ ...r, label: r.task.length > 44 ? r.task.slice(0, 42) + "…" : r.task }));
  if (!data.length) return <p className="text-muted">Nothing repetitive found yet.</p>;
  return (
    <div>
      <ResponsiveContainer width="100%" height={36 + data.length * 46}>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 44, top: 4, bottom: 4 }} barCategoryGap={10}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="label" width={230} tick={{ fontSize: 13, fill: "#14213D" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(20,33,61,.06)" }}
            formatter={(v) => [`${v} hrs/week, estimate`, ""]} labelFormatter={(l) => String(l)} />
          <Bar dataKey="hoursPerWeek" fill="#1D4E89" radius={[0, 4, 4, 0]}>
            <LabelList dataKey="hoursPerWeek" position="right" formatter={(v: unknown) => `${v}h`} style={{ fill: "#14213D", fontSize: 13 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-sm text-muted">Hours per week, estimated from the evidence below.</p>
    </div>
  );
}
