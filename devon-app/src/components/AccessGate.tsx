"use client";

import { useState } from "react";

export function AccessGate() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
    if (res.ok) window.location.reload();
    else {
      setError("That key is not right.");
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-sm px-5 py-16">
      <h1 className="text-xl font-bold">Enter the access key</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        This Tailor is set up for one business. The key is in its settings (TAILOR_ACCESS_KEY).
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-2">
        <input id="access-key" className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus aria-label="Access key" />
        {error && (
          <p className="text-sm" role="alert" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={busy || !key}>
          Continue
        </button>
      </form>
    </main>
  );
}
