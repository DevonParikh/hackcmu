"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function StartForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [pain, setPain] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Try again" on a stopped report links back here with the same details in the address.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const u = q.get("url"), c = q.get("competitors"), p = q.get("pain");
      if (u) setUrl(u);
      if (c) setCompetitors(c.split(",").map((x) => x.trim()).filter(Boolean).join(", "));
      if (p) setPain(p);
    } catch {
      /* no address bar to read from */
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("url", url);
      fd.set("name", name);
      fd.set("competitors", competitors);
      fd.set("pain", pain);
      fd.set("notes", notes);
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the analysis");
      router.push(`/runs/${data.runId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card grid gap-4 p-5 md:p-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Analyze your business</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Start with your website. Everything else is optional.
        </p>
      </div>
      <label className="field">
        <span>Your website</span>
        <input id="url" className="input" required placeholder="example.com" inputMode="url" autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span>
            Business name <em>(optional)</em>
          </span>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Competitors&apos; websites <em>(optional)</em>
          </span>
          <input id="competitors" className="input" placeholder="rival.com, another.com" value={competitors} onChange={(e) => setCompetitors(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>
          What takes up the most time right now? <em>(optional)</em>
        </span>
        <textarea id="pain" className="input" rows={2} placeholder="e.g. answering the same emails about hours and pricing" value={pain} onChange={(e) => setPain(e.target.value)} />
      </label>
      <details className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--rule)" }}>
        <summary className="text-sm font-semibold">Add documents your website doesn&apos;t cover (optional)</summary>
        <div className="mt-3 grid gap-3">
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            A menu, price list, policies, or FAQ as PDF or text. You can also add these later on the report.
          </p>
          <input id="files" type="file" multiple accept=".pdf,.txt,.md,.csv,.json,.html,.htm,text/plain,application/pdf" className="text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          {files.length > 0 && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {files.map((f) => f.name).join(", ")}
            </p>
          )}
          <textarea id="notes" className="input" rows={2} placeholder="Anything else customers should know, in a few lines" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </details>
      {error && (
        <p className="text-sm" role="alert" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button className="btn btn-lg" type="submit" disabled={busy}>
          {busy ? "Starting…" : "Analyze my business"}
        </button>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          Takes about a minute. Nothing is published without you.
        </span>
      </div>
    </form>
  );
}
