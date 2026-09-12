"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [pain, setPain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          name,
          pain,
          competitors: competitors.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the analysis");
      router.push(`/runs/${data.runId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel grid gap-4 p-5">
      <label className="grid gap-1">
        <span className="text-sm font-semibold">Website URL</span>
        <input id="url" className="input" required placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">
            Company name <span style={{ color: "var(--muted)" }}>(optional)</span>
          </span>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold">
            Competitor URLs <span style={{ color: "var(--muted)" }}>(optional, comma-separated)</span>
          </span>
          <input id="competitors" className="input" placeholder="https://rival.com, https://other.com" value={competitors} onChange={(e) => setCompetitors(e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-sm font-semibold">
          What takes up the most time right now? <span style={{ color: "var(--muted)" }}>(optional)</span>
        </span>
        <textarea id="pain" className="input" rows={2} placeholder="e.g. answering the same emails about hours and pricing" value={pain} onChange={(e) => setPain(e.target.value)} />
      </label>
      {error && (
        <p className="text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      <div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Starting…" : "Analyze"}
        </button>
      </div>
    </form>
  );
}
