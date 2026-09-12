"use client";
// Screen 1: the website, optional detail (name, competitors, the biggest time sink, documents), a live log, then straight to the report.

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

const ACCEPT = ".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,text/plain,application/pdf";

export default function Start() {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [pain, setPain] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
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
    const fd = new FormData();
    fd.set("url", url);
    fd.set("name", name);
    fd.set("competitors", competitors);
    fd.set("pain", pain);
    fd.set("notes", notes);
    for (const f of files) fd.append("files", f);
    const r = await fetch("/api/analyze", { method: "POST", body: fd });
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

  const extras = [name, competitors, pain, notes].filter(s => s.trim()).length + files.length;

  return (
    <div>
      <form onSubmit={analyze} className="grid gap-3">
        <div className="flex gap-2">
          <input
            value={url} onChange={e => setUrl(e.target.value)} placeholder="yourbakery.com"
            aria-label="Company website" autoComplete="url" inputMode="url" disabled={busy}
            className="input min-w-0 flex-1"
          />
          <button type="submit" disabled={busy || !url.trim()} className="btn">
            {busy ? "Reading…" : "Analyze"}
          </button>
        </div>
        <details className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold">
            Add detail{extras ? ` (${extras} added)` : ""} <span className="font-normal text-muted">— name, competitors, what eats your time, documents. All optional.</span>
          </summary>
          <div className="mt-3 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span>Business name <em>(optional)</em></span>
                <input className="input" value={name} onChange={e => setName(e.target.value)} disabled={busy} autoComplete="organization" />
              </label>
              <label className="field">
                <span>Competitors&apos; websites <em>(optional)</em></span>
                <input className="input" placeholder="rival.com, another.com" value={competitors} onChange={e => setCompetitors(e.target.value)} disabled={busy} />
              </label>
            </div>
            <label className="field">
              <span>What takes up the most time right now? <em>(optional)</em></span>
              <textarea className="input" rows={2} placeholder="e.g. answering the same emails about hours and pricing" value={pain} onChange={e => setPain(e.target.value)} disabled={busy} />
            </label>
            <label className="field">
              <span>Documents your website doesn&apos;t cover <em>(optional)</em></span>
              <input type="file" multiple accept={ACCEPT} className="text-sm" disabled={busy} onChange={e => setFiles(Array.from(e.target.files ?? []).slice(0, 8))} />
              <span className="text-xs text-muted">
                {files.length ? files.map(f => f.name).join(", ") : "A menu, price list, policies, or FAQ as PDF, text, Markdown, CSV, or HTML. Up to 8 files, 10 MB each."}
              </span>
            </label>
            <label className="field">
              <span>Anything else customers should know <em>(optional)</em></span>
              <textarea className="input" rows={2} placeholder="A few lines: hours, policies, what people always ask" value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} />
            </label>
          </div>
        </details>
        <p className="text-xs text-muted">Takes about a minute. Nothing is published without you.</p>
      </form>
      {quick && (
        <div className="mt-6 rounded-md border border-line bg-paper px-5 py-4">
          <p className="text-sm text-muted">Quick read of the site&apos;s structure, before reading a word</p>
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
        <ul className="mt-6 space-y-2 border-l-2 border-line pl-4 text-muted" aria-live="polite">
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
