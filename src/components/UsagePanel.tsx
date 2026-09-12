"use client";

import { useEffect, useState } from "react";
import { UsageBars } from "@/components/charts";

type Usage = { conversations: number; replies: number; answered: number; handedOff: number; mode: "chat" | "form"; perDay: { day: string; answered: number; handedOff: number }[] };

export function UsagePanel({ slug, minutesRange }: { slug: string; minutesRange: [number, number] | null }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/tools/${encodeURIComponent(slug)}/usage`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load usage");
        if (alive) setUsage(data);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [slug]);

  if (error)
    return (
      <p className="text-sm" style={{ color: "var(--bad)" }}>
        {error}
      </p>
    );
  if (!usage)
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Loading…
      </p>
    );
  if (usage.replies === 0)
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Nothing measured yet. Once people use it, this panel counts real conversations and replaces the estimate above.
      </p>
    );
  const savedLow = minutesRange ? Math.round(((usage.answered * minutesRange[0]) / 60) * 100) / 100 : null;
  const savedHigh = minutesRange ? Math.round(((usage.answered * minutesRange[1]) / 60) * 100) / 100 : null;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Conversations" value={usage.conversations} />
        <Tile label={usage.mode === "form" ? "Drafts written" : "Replies"} value={usage.replies} />
        <Tile label="Answered without hand-off" value={usage.answered} />
        <Tile label="Handed to you" value={usage.handedOff} />
      </div>
      <UsageBars perDay={usage.perDay} />
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {usage.replies >= 20
          ? `${Math.round((usage.answered / usage.replies) * 100)}% answered without a hand-off so far.`
          : "Too few replies to read as a trend yet."}{" "}
        {savedLow !== null && savedHigh !== null ? `Time not spent replying so far: about ${savedLow}–${savedHigh} hours, using your minutes-per-question answer.` : ""} &ldquo;Answered&rdquo; means the assistant did not hand off; read a few transcripts to check quality.
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--rule)" }}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </div>
    </div>
  );
}
