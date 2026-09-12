"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicTool } from "@/lib/publicTool";

type Msg = { role: "user" | "assistant"; content: string };

function textOn(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff";
}

export function ToolView({ tool, embed }: { tool: PublicTool; embed: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: tool.greeting }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    if (tool.mode === "chat") setMessages((m) => [...m, { role: "user", content: clean }]);
    else setMessages([{ role: "user", content: clean }]);
    try {
      const res = await fetch(`/api/tools/${encodeURIComponent(tool.slug)}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: clean, conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      if (data.conversationId) setConversationId(data.conversationId);
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError((err as Error).message);
      setInput(clean);
      if (tool.mode === "chat") setMessages((m) => m.filter((x, i) => !(i === m.length - 1 && x.role === "user" && x.content === clean)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const primary = tool.brand.primary;
  const onPrimary = textOn(primary);
  const [copied, setCopied] = useState<number | null>(null);
  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked; the text is still selectable */
    }
  }
  const showSuggestions = messages.length <= 1 && tool.suggestedQuestions.length > 0;
  return (
    <main className={embed ? "flex h-screen flex-col" : "mx-auto flex max-w-2xl flex-col px-5 py-6"}>
      {!embed && (
        <div className="mb-3 flex items-center justify-between text-sm">
          <Link href={`/runs/${tool.runId}`} style={{ color: "var(--accent)" }}>
            ← Back to the report
          </Link>
          {tool.demo && (
            <span className="chip" title="No Claude API key is set, so answers are quoted from the website instead of written by Claude">
              demo mode
            </span>
          )}
        </div>
      )}
      <div className={embed ? "flex flex-1 flex-col overflow-hidden" : "panel flex flex-col overflow-hidden"} style={{ minHeight: embed ? undefined : 560 }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: primary, color: onPrimary }}>
          {tool.brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tool.brand.logoUrl} alt="" className="h-7 w-7 rounded bg-white/90 object-contain p-0.5" />
          )}
          <div className="min-w-0">
            <div className="truncate font-semibold">{tool.name}</div>
            <div className="truncate text-xs opacity-80">{tool.templateName}</div>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ background: "var(--paper)" }} aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed" style={m.role === "user" ? { background: primary, color: onPrimary } : { background: "var(--panel)", border: "1px solid var(--rule)" }}>
                {m.content}
                {tool.mode === "form" && m.role === "assistant" && i > 0 && (
                  <div className="mt-2">
                    <button type="button" className="btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => copy(i, m.content)}>
                      {copied === i ? "Copied" : "Copy draft"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {showSuggestions && (
            <div className="flex flex-wrap gap-2">
              {tool.suggestedQuestions.map((q) => (
                <button key={q} type="button" className="btn-ghost" style={{ padding: "6px 10px", fontSize: 13 }} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          {busy && (
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              Thinking…
            </div>
          )}
          {error && (
            <div className="text-xs" role="alert" style={{ color: "var(--bad)" }}>
              {error}
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2 border-t p-3"
          style={{ borderColor: "var(--rule)", background: "var(--panel)" }}
        >
          {tool.mode === "form" ? (
            <textarea id="tool-input" ref={inputRef as React.RefObject<HTMLTextAreaElement>} className="input" rows={3} placeholder={tool.placeholder} value={input} onChange={(e) => setInput(e.target.value)} aria-label={tool.formLabel} />
          ) : (
            <input id="tool-input" ref={inputRef as React.RefObject<HTMLInputElement>} className="input" placeholder={tool.placeholder} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Your message" autoComplete="off" />
          )}
          <button className="btn self-end" style={{ background: primary, color: onPrimary }} type="submit" disabled={busy || !input.trim()}>
            {tool.mode === "form" ? "Draft" : "Send"}
          </button>
        </form>
      </div>
      {!embed && (
        <p className="mt-3 text-center text-xs" style={{ color: "var(--muted)" }}>
          Answers come from the business&apos;s own pages and documents. For anything else,{" "}
          {tool.escalation.email ? `email ${tool.escalation.email}` : tool.escalation.phone ? `call ${tool.escalation.phone}` : "use the contact page"}.
        </p>
      )}
    </main>
  );
}
