"use client";
// Screen 3 controls. The allowance control is the one that matters: it writes to the chain, not to a config file.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Tpl = { id: string; name: string; money: boolean };
type Chain = { token: string; balance: string; allowance: string } | null;

export default function BuildForm(p: { runId: string; company: string; templates: Tpl[]; defaultTemplate: string; defaultName: string; defaultTone: string; accent: string }) {
  const [template, setTemplate] = useState(p.defaultTemplate);
  const [name, setName] = useState(p.defaultName);
  const [tone, setTone] = useState(p.defaultTone);
  const [offLimits, setOffLimits] = useState("");
  const [chain, setChain] = useState<Chain>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [cap, setCap] = useState("50");
  const [setting, setSetting] = useState(false);
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const money = p.templates.find(t => t.id === template)?.money ?? false;

  async function loadChain() {
    try { const r = await fetch("/api/allowance"); const j = await r.json(); if (r.ok) { setChain(j); setChainErr(null); } else setChainErr(j.error); }
    catch { setChainErr("Can't reach the chain right now."); }
  }
  useEffect(() => { loadChain(); }, []);

  async function applyCap() {
    setSetting(true); setErr(null);
    try {
      const r = await fetch("/api/allowance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: Number(cap) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      await loadChain();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setSetting(false);
  }

  async function build() {
    setBuilding(true); setErr(null);
    try {
      const r = await fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: p.runId, name, tone, offLimits, template }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      router.push(`/t/${j.slug}/owner`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBuilding(false); }
  }

  const field = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-ink focus:outline-2 focus:outline-blue";

  return (
    <div className="mt-12 space-y-8">
      <label className="block">
        <span className="text-sm text-muted">Which tool</span>
        <select value={template} onChange={e => setTemplate(e.target.value)} className={field}>
          {p.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-sm text-muted">What it calls itself</span>
        <input value={name} onChange={e => setName(e.target.value)} className={field} />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Tone</span>
        <select value={tone} onChange={e => setTone(e.target.value)} className={field}>
          <option value="warm">Warm and brief</option>
          <option value="plain">Plain and direct</option>
          <option value="formal">Polite and professional</option>
        </select>
      </label>
      <label className="block">
        <span className="text-sm text-muted">Off-limits — things it should hand to a person (comma-separated)</span>
        <input value={offLimits} onChange={e => setOffLimits(e.target.value)} placeholder="allergies, complaints about staff, catering quotes" className={field} />
      </label>

      {money && (
        <section className="rounded-md border px-5 py-5" style={{ borderColor: p.accent }}>
          <h2 className="display text-[22px] font-medium">Refund allowance</h2>
          <p className="mt-1 text-sm text-muted">
            The tool can issue refunds up to this amount, total. The number lives on the Solana devnet as a token delegation —
            not in the tool's instructions — so nothing a customer types can raise it.
          </p>
          {chain ? (
            <p className="mt-4">
              Right now the tool can spend <span className="display text-3xl font-semibold tabular-nums" style={{ color: p.accent }}>{chain.allowance}</span> {chain.token}
              <span className="text-muted"> of the {chain.balance} in the account.</span>
            </p>
          ) : <p className="mt-4 text-sm text-muted">{chainErr ?? "Reading the chain…"}</p>}
          <div className="mt-4 flex gap-2">
            <input type="number" min={0} step={1} value={cap} onChange={e => setCap(e.target.value)} aria-label="New allowance" className="w-32 rounded-md border border-line bg-panel px-3 py-2 tabular-nums" />
            <button type="button" onClick={applyCap} disabled={setting || !chain} className="rounded-md bg-ink px-4 py-2 text-white disabled:opacity-50">
              {setting ? "Signing as owner…" : "Set on chain"}
            </button>
          </div>
        </section>
      )}

      {err && <p className="text-red">{err}</p>}
      <button type="button" onClick={build} disabled={building} className="rounded-md px-6 py-3 text-white disabled:opacity-60" style={{ background: p.accent }}>
        {building ? "Building and self-testing…" : `Build ${name || "it"}`}
      </button>
    </div>
  );
}
