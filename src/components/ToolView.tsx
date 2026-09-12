"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicTool } from "@/lib/publicTool";

type Msg = { role: "user" | "assistant"; content: string };

export function ToolView({ tool, embed }: { tool: PublicTool; embed: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: tool.greeting }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    if (tool.mode === "chat") setMessages((m) => [...m, { role: "user", content: text }]);
    else setMessages([{ role: "user", content: text }]);
    try {
      const res = await fetch(`/api/tools/${encodeURIComponent(tool.slug)}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      if (data.conversationId) setConversationId(data.conversationId);
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const primary = tool.brand.primary;
  return (
    <main className={embed ? "flex h-screen flex-col" : "mx-auto flex max-w-2xl flex-col px-5 py-8"} style={{ ["--brand" as string]: primary }}>
      <div className={embed ? "flex flex-1 flex-col overflow-hidden" : "panel flex flex-col overflow-hidden"} style={{ minHeight: embed ? undefined : 560 }}>
        <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: primary }}>
          {tool.brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tool.brand.logoUrl} alt="" className="h-7 w-7 rounded bg-white/90 object-contain p-0.5" />
          )}
          <div className="min-w-0">
            <div className="truncate font-semibold">{tool.name}</div>
            <div className="truncate text-xs opacity-80">{tool.templateName}</div>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ background: "var(--paper)" }}>
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
                style={m.role === "user" ? { background: primary, color: "#fff" } : { background: "var(--panel)", border: "1px solid var(--rule)" }}
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              Thinking…
            </div>
          )}
          {error && (
            <div className="text-xs" style={{ color: "var(--bad)" }}>
              {error}
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form onSubmit={send} className="flex gap-2 border-t p-3" style={{ borderColor: "var(--rule)", background: "var(--panel)" }}>
          {tool.mode === "form" ? (
            <textarea id="tool-input" className="input" rows={3} placeholder={tool.placeholder} value={input} onChange={(e) => setInput(e.target.value)} aria-label={tool.formLabel} />
          ) : (
            <input id="tool-input" className="input" placeholder={tool.placeholder} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Message" />
          )}
          <button className="btn self-end" style={{ background: primary }} type="submit" disabled={busy || !input.trim()}>
            {tool.mode === "form" ? "Draft" : "Send"}
          </button>
        </form>
      </div>
      {!embed && (
        <p className="mt-3 text-center text-xs" style={{ color: "var(--muted)" }}>
          Answers come from the company&apos;s own website. For anything else, {tool.escalation.email ? `email ${tool.escalation.email}` : tool.escalation.phone ? `call ${tool.escalation.phone}` : "use the contact page"}.
        </p>
      )}
    </main>
  );
}
