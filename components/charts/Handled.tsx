"use client";
// C5 — questions handled per day: answered by the tool vs handed to a person.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function Handled({ days, accent }: { days: { day: string; answered: number; handoff: number }[]; accent: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={days} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
        <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#5D6673" }} tickFormatter={d => d.slice(5)} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} width={28} tick={{ fontSize: 12, fill: "#5D6673" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid #E4E2DA", fontSize: 14 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
        <Bar dataKey="answered" name="answered by the tool" stackId="a" fill={accent} isAnimationActive animationDuration={400} />
        <Bar dataKey="handoff" name="handed to a person" stackId="a" fill="#B9B5AA" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={400} />
      </BarChart>
    </ResponsiveContainer>
  );
}
