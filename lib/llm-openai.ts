// lib/llm-openai.ts — any OpenAI-compatible chat endpoint as a provider in the chain (lib/llm.ts):
// OpenAI itself, or a gateway such as Groq, Together, OpenRouter, or a local Ollama / vLLM server.
//
// Configured by OPENAI_API_KEY, OPENAI_MODEL, and optionally OPENAI_BASE_URL (default https://api.openai.com/v1).
// No web search: it takes text and JSON turns only.

export const openaiConfigured = () => !!process.env.OPENAI_API_KEY;
const openaiBase  = () => (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
export const openaiModel = () => process.env.OPENAI_MODEL ?? "gpt-4o";

const clip = (s: string, n = 160) => s.replace(/\s+/g, " ").slice(0, n);

export async function openaiChat(prompt: string, opts: { json?: boolean; system?: string }, dead: Set<string>): Promise<string> {
  const key = process.env.OPENAI_API_KEY; if (!key) throw new Error("OPENAI_API_KEY not set");
  if (dead.has("openai")) throw new Error("openai exhausted");
  const model = openaiModel();
  const messages = [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content: prompt }];
  const bodies: Record<string, unknown>[] = [
    { model, messages, temperature: opts.json ? 0 : 0.2, ...(opts.json ? { response_format: { type: "json_object" } } : {}) },
    { model, messages },                                    // plain, for servers that reject temperature or response_format
  ];
  let lastErr = new Error("openai: no attempts");
  for (const body of bodies) {
    const r = await fetch(`${openaiBase()}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) {
      const data = await r.json();
      return data?.choices?.[0]?.message?.content ?? "";
    }
    const text = await r.text();
    lastErr = new Error(`${new URL(openaiBase()).hostname} ${r.status} (${model}): ${clip(text)}`);
    if (r.status === 401) { dead.add("openai"); throw lastErr; }
    if (r.status === 429 && /quota|billing|credit/i.test(text)) { dead.add("openai"); throw lastErr; }
    if (r.status !== 400) throw lastErr;                        // only a 400 (unknown field) earns the plain retry
  }
  throw lastErr;
}
