"use client";

import Link from "next/link";
import { useState } from "react";

type Props = {
  kind: "demo" | "consult";
  /** Label for the free-text box, since a demo and a consultation ask for different things. */
  messageLabel: string;
  messagePlaceholder: string;
  submitLabel: string;
  askTime?: boolean;
};

export function ContactForm({ kind, messageLabel, messagePlaceholder, submitLabel, askTime }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name, email, company, website, preferredTime, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send that");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card p-6 fade-in" role="status">
        <div className="check" aria-hidden="true">
          ✓
        </div>
        <h2 className="mt-3 text-xl font-bold">Thanks, {name.split(" ")[0] || "we have it"}.</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {kind === "demo" ? "We will email you within one working day with a time for the demo." : "A consultant will email you within one working day to set up a call."}
        </p>
        <p className="mt-4 text-sm">
          In the meantime, you can{" "}
          <Link href="/#analyze" className="link">
            run the free analysis
          </Link>{" "}
          on your own website. It takes about a minute.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card grid gap-4 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span>Your name</span>
          <input className="input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="input" required type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span>
            Business name <em>(optional)</em>
          </span>
          <input className="input" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Website <em>(optional)</em>
          </span>
          <input className="input" inputMode="url" autoComplete="url" placeholder="example.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {askTime && (
        <label className="field">
          <span>
            When suits you? <em>(optional)</em>
          </span>
          <input className="input" placeholder="e.g. weekday mornings, Eastern time" value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>
          {messageLabel} <em>(optional)</em>
        </span>
        <textarea className="input" rows={3} placeholder={messagePlaceholder} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      {error && (
        <p className="text-sm" role="alert" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Sending…" : submitLabel}
        </button>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          No account needed. We reply within one working day.
        </span>
      </div>
    </form>
  );
}
