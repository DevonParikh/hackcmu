"use client";
// The customer-facing chat. One request per turn. A refund comes back as a verdict card: SETTLED or REFUSED, with the explorer link.

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; refund?: Refund | null; refundError?: string | null; handoff?: boolean };
type Refund = { amount: string; to: string; url: string; landed: boolean; blocked: boolean; chainError: unknown; balanceBefore: string; allowanceBefore: string; allowanceAfter: string | null; why: "allowance" | "balance" | "other" | null };

const SR = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;

export default function Widget(p: { slug: string; name: string; company: string; money: boolean; accent: string; demoWallet: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: `Hi — I'm ${p.name}. Ask me anything about ${p.company}.${p.money ? " I can also sort out refunds." : ""}` }]);
  const [text, setText] = useState("");
  const [wallet, setWallet] = useState(p.demoWallet);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [voice, setVoice] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function speak(t: string) {
    if (!voice) return;
    try {
      const r = await fetch(`/api/t/${p.slug}/speak`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
      if (r.status === 200) { const url = URL.createObjectURL(await r.blob()); await new Promise(res => { const a = new Audio(url); a.onended = a.onerror = () => res(null); a.play().catch(() => res(null)); }); URL.revokeObjectURL(url); return; }
    } catch {}
    if ("speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(t); speechSynthesis.speak(u); }
  }

  async function send(t: string) {
    const content = t.trim(); if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await fetch(`/api/t/${p.slug}/chat`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })), wallet: wallet.trim() || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsgs(m => [...m, { role: "assistant", content: j.reply, refund: j.refund, refundError: j.refundError, handoff: j.handoff }]);
      speak(j.refund ? (j.refund.blocked ? `${j.reply} Actually — the network refused that refund.` : j.reply) : j.reply);
    } catch (e) { setMsgs(m => [...m, { role: "assistant", content: `Sorry — something went wrong (${e instanceof Error ? e.message : String(e)}).` }]); }
    setBusy(false);
  }

  function listen() {
    if (!SR) return;
    const rec = new SR(); rec.lang = "en-US"; rec.interimResults = false;
    setLive(true); setVoice(true);
    rec.onresult = (e: any) => { setLive(false); send(e.results[0][0].transcript); };
    rec.onerror = rec.onend = () => setLive(false);
    rec.start();
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-baseline justify-between gap-3">
        <div><p className="display text-xl font-semibold">{p.name}</p><p className="text-sm text-muted">{p.company}</p></div>
        <label className="text-sm text-muted"><input type="checkbox" checked={voice} onChange={e => setVoice(e.target.checked)} className="mr-1.5 align-middle" />speak replies</label>
      </header>

      <ol className="mt-6 flex-1 space-y-4">
        {msgs.map((m, i) => (
          <li key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={`max-w-[85%] rounded-lg px-4 py-3 ${m.role === "user" ? "text-white" : "bg-panel border border-line"}`} style={m.role === "user" ? { background: p.accent } : undefined}>
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              {m.handoff && <p className="mt-2 text-xs text-muted">Passed to a person at {p.company}.</p>}
              {m.refund && <RefundCard r={m.refund} />}
              {m.refundError && <p className="mt-2 text-sm text-red">Refund didn't go through: {m.refundError}</p>}
            </div>
          </li>
        ))}
        {busy && <li><div className="inline-block rounded-lg border border-line bg-panel px-4 py-3 text-muted">…</div></li>}
        <div ref={end} />
      </ol>

      <form onSubmit={e => { e.preventDefault(); send(text); }} className="mt-6 flex gap-2">
        {SR && (
          <button type="button" onClick={listen} aria-label="Speak" className={`h-11 w-11 shrink-0 rounded-full text-white ${live ? "animate-pulse" : ""}`} style={{ background: p.accent }}>
            <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        )}
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Ask a question…" aria-label="Message" disabled={busy}
          className="min-w-0 flex-1 rounded-md border border-line bg-panel px-4 py-2.5 focus:outline-2 focus:outline-blue" />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-md bg-ink px-4 py-2.5 text-white disabled:opacity-50">Send</button>
      </form>
      {p.money && (
        <p className="mt-3 text-xs text-muted">
          Refunds go to <input value={wallet} onChange={e => setWallet(e.target.value)} aria-label="Wallet for refunds" className="w-40 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-xs" /> on Solana devnet.
        </p>
      )}
    </div>
  );
}

function RefundCard({ r }: { r: Refund }) {
  const reason = JSON.stringify(r.chainError ?? "");
  const refused = r.why === "allowance"
    ? `The tool did what it was asked and tried to refund ${r.amount}. The account holds ${r.balanceBefore}; the tool's allowance is ${r.allowanceBefore}. The token program refused it. That cap is on the chain, not in the prompt.`
    : r.why === "balance"
    ? `The tool tried to refund ${r.amount}, more than the ${r.balanceBefore} in the account. The token program refused it.`
    : `The tool tried to refund ${r.amount}. The token program refused it: ${reason}.`;
  return (
    <div className={`mt-3 rounded-md border-2 px-3 py-2 ${r.landed ? "border-green" : "border-red"}`}>
      <p className={`display text-lg font-bold tracking-wide ${r.landed ? "text-green" : "text-red"}`}>{r.landed ? "SETTLED" : "REFUSED"}</p>
      <p className="mt-1 text-sm">{r.landed ? `${r.amount} refunded to ${r.to}. The tool's allowance is now ${r.allowanceAfter}.` : refused}</p>
      <a href={r.url} target="_blank" rel="noopener" className="mt-1 inline-block text-sm underline">View on Solana Explorer</a>
    </div>
  );
}
