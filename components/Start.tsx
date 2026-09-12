"use client";
// Screen 1: one field, a live log, then straight to the report.

import { useState } from "react";
import { useRouter } from "next/navigation";


// Consecutive "Reading …" lines become one counting line; only the last three lines are shown.
function collapse(lines: string[]): { text: string; sub?: string }[] {
  const out: { text: string; sub?: string }[] = [];
  let reading = 0, last = "";
  const flush = () => { if (reading) { out.push({ text: `Reading ${reading} page${reading === 1 ? "" : "s"}`, sub: last }); reading = 0; } };
  for (const l of lines) {
    if (l.startsWith("Reading ")) { reading++; last = l.slice(8); continue; }
    flush(); out.push({ text: l });
  }
  flush();
  return out.slice(-3);
}

export default function Start() {
  const [url, setUrl] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<{
    n: number;
    template?: { name: string; prob: number; acc: number; baseline: number; reasons: { label: string; weight: number }[] };
    hours?: { value: number; mae: number; contributions: { label: string; hours: number }[] };
  } | null>(null);
  const router = useRouter();

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true); setLines([]); setQuick(null);
    const r = await fetch("/api/analyze", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    });
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => ({ error: r.statusText }));
      setLines([j.error ?? "Something went wrong."]); setBusy(false); return;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(chunk)?.[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? "{}");
        if (ev === "log")   setLines(l => [...l, data.m]);
        if (ev === "estimate") setQuick(data);
        if (ev === "error") setLines(l => [...l, `Stopped: ${data.m}`]);
        if (ev === "done")  router.push(`/report/${data.id}`);
      }
    }
    setBusy(false);
  }

  return (
    <div className="max-w-xl">
      <form onSubmit={analyze} className="flex gap-2">
        <input
          value={url} onChange={e => setUrl(e.target.value)} placeholder="yourbakery.com"
          aria-label="Company website" autoComplete="off" disabled={busy}
          className="min-w-0 flex-1 rounded-md border border-line bg-panel px-4 py-3 text-ink placeholder:text-muted/60 focus:outline-2 focus:outline-blue disabled:opacity-60"
        />
        <button type="submit" disabled={busy || !url.trim()}
          className="rounded-md bg-ink px-5 py-3 text-white disabled:opacity-50">
          {busy ? "Reading…" : "Analyze"}
        </button>
      </form>
      {quick && (
        <div className="mt-8 rounded-md border border-line bg-panel px-5 py-4">
          <p className="text-sm text-muted">Quick read of the site's structure, before reading a word</p>
          {quick.template && (
            <p className="display mt-1 text-2xl font-semibold">Likely needs {quick.template.name} <span className="text-muted tabular-nums">({Math.round(quick.template.prob * 100)}%)</span></p>
          )}
          {quick.hours && <p className="display mt-1 text-2xl font-semibold tabular-nums">about {quick.hours.value} hours a week</p>}
          <p className="mt-1 text-sm text-muted">
            {quick.template?.reasons.map(r => r.label).join(" · ")}
            {quick.template?.reasons.length ? " — " : ""}the full read is on its way.
          </p>
        </div>
      )}
      {lines.length > 0 && (() => { const shown = collapse(lines); return (
        <ul className="mt-8 space-y-2 border-l-2 border-line pl-4 text-muted" aria-live="polite">
          {shown.map((l, i) => (
            <li key={`${i}-${l.text}`} className={i === shown.length - 1 && busy ? "text-ink" : ""}>
              {l.text}
              {l.sub && <span className="ml-2 block truncate text-sm text-muted/80 sm:inline">{l.sub}</span>}
            </li>
          ))}
        </ul>
      ); })()}
    </div>
  );
}
