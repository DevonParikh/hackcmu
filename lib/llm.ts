// lib/llm.ts — one interface, several providers, so a quota error is a log line and not a dead demo.
//
//   generateText(prompt, { grounding })  → prose; with grounding, the provider searches the web
//   generateJSON(schema, prompt)          → zod-validated object, one corrective retry per provider
//
// Order: every Gemini key in GEMINI_API_KEYS (comma-separated; falls back to GEMINI_API_KEY), then xAI (XAI_API_KEY).
// A Gemini key that answers 429 "quota" is skipped for the rest of the process. lastProvider() says who answered.

import { z } from "zod";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const clip = (s: string, n = 160) => s.replace(/\s+/g, " ").slice(0, n);

// ---------------------------------------------------------------- config
function geminiKeys(): string[] {
  const list = (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return [...new Set(list)];
}
function geminiModels(): string[] {
  const a = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
  const b = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash";
  return a === b ? [a] : [a, b];
}
const xaiKey    = () => process.env.XAI_API_KEY;
const xaiModels = () => { const a = process.env.XAI_MODEL ?? "grok-4.20-non-reasoning"; return a === "grok-4.3" ? [a] : [a, "grok-4.3"]; };

const dead = new Set<string>();                  // provider ids exhausted this process
let last = "";
export const lastProvider = () => last;

// ---------------------------------------------------------------- gemini
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

async function geminiOnce(key: string, model: string, body: Record<string, unknown>): Promise<string> {
  const id = `gemini:${key.slice(-6)}`;
  if (dead.has(id)) throw new Error(`${id} exhausted`);
  let lastErr = new Error("gemini: no attempts");
  for (let i = 0; i < 2; i++) {
    let r: Response;
    try {
      r = await fetch(`${GEMINI}/${model}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      });
    } catch (e) { lastErr = new Error(`Gemini network/timeout (${model})`); await sleep(1500); continue; }
    if (r.ok) {
      const data = await r.json();
      last = `Gemini ${model}`;
      return (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("")
        + "\u0000" + JSON.stringify((data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c: any) => c?.web?.uri).filter(Boolean));
    }
    const text = await r.text();
    lastErr = new Error(`Gemini ${r.status} (${model}): ${clip(text)}`);
    if (r.status === 429 && /quota|billing/i.test(text)) { dead.add(id); throw lastErr; }   // daily cap: this key is done
    if (r.status === 404) throw lastErr;                                                   // wrong model name: don't retry
    if (r.status < 500 && r.status !== 429) throw lastErr;                                 // bad request won't improve
    await sleep(r.status === 429 ? 5000 : 1500 * (i + 1));
  }
  throw lastErr;
}

function geminiBody(prompt: string, opts: { grounding?: boolean; json?: boolean; system?: string }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: opts.json ? { temperature: 0, responseMimeType: "application/json" } : { temperature: 0.2 },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.grounding) body.tools = [{ google_search: {} }];
  return body;
}

// ---------------------------------------------------------------- xai (grok)
async function xaiChat(model: string, prompt: string, opts: { json?: boolean; system?: string }): Promise<string> {
  const key = xaiKey(); if (!key) throw new Error("XAI_API_KEY not set");
  if (dead.has("xai")) throw new Error("xai exhausted");
  const messages = [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content: prompt }];
  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: opts.json ? 0 : 0.2, ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) {
    const text = await r.text();
    if (r.status === 429 && /quota|billing|credit/i.test(text)) dead.add("xai");
    throw new Error(`xAI ${r.status} (${model}): ${clip(text)}`);
  }
  const data = await r.json();
  last = `Grok ${model}`;
  return data?.choices?.[0]?.message?.content ?? "";
}

// Web search is only on the Responses endpoint.
async function xaiSearch(model: string, prompt: string): Promise<{ text: string; cites: string[] }> {
  const key = xaiKey(); if (!key) throw new Error("XAI_API_KEY not set");
  if (dead.has("xai")) throw new Error("xai exhausted");
  const r = await fetch("https://api.x.ai/v1/responses", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: prompt, tools: [{ type: "web_search" }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    const text = await r.text();
    if (r.status === 429 && /quota|billing|credit/i.test(text)) dead.add("xai");
    throw new Error(`xAI search ${r.status} (${model}): ${clip(text)}`);
  }
  const data = await r.json();
  const parts = (data?.output ?? []).flatMap((o: any) => o?.content ?? []).filter((c: any) => c?.type === "output_text");
  const text = parts.map((c: any) => c.text ?? "").join("\n") || data?.output_text || "";
  const cites = parts.flatMap((c: any) => (c.annotations ?? []).map((a: any) => a?.url).filter(Boolean));
  last = `Grok ${model} + web search`;
  return { text, cites: [...new Set(cites as string[])] };
}

// ---------------------------------------------------------------- the chain
type TextAttempt = () => Promise<{ text: string; cites: string[] }>;

function textAttempts(prompt: string, opts: { grounding?: boolean; system?: string }): TextAttempt[] {
  const out: TextAttempt[] = [];
  for (const key of geminiKeys()) for (const model of geminiModels())
    out.push(async () => { const [text, cites] = (await geminiOnce(key, model, geminiBody(prompt, opts))).split("\u0000"); return { text, cites: JSON.parse(cites || "[]") }; });
  for (const model of xaiModels())
    out.push(() => opts.grounding ? xaiSearch(model, prompt) : xaiChat(model, prompt, { system: opts.system }).then(text => ({ text, cites: [] })));
  return out;
}

export async function generateText(prompt: string, opts: { grounding?: boolean; system?: string } = {}): Promise<{ text: string; cites: string[] }> {
  const errors: string[] = [];
  for (const attempt of textAttempts(prompt, opts)) {
    try { return await attempt(); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  throw new Error(`No LLM provider could answer: ${errors.map(e => clip(e, 90)).join(" | ")}`);
}

type JsonAttempt = (prompt: string) => Promise<string>;

function jsonAttempts(opts: { system?: string }): { id: string; run: JsonAttempt }[] {
  const out: { id: string; run: JsonAttempt }[] = [];
  for (const key of geminiKeys()) for (const model of geminiModels())
    out.push({ id: `Gemini ${model}`, run: async p => (await geminiOnce(key, model, geminiBody(p, { ...opts, json: true }))).split("\u0000")[0] });
  for (const model of xaiModels())
    out.push({ id: `Grok ${model}`, run: p => xaiChat(model, p, { ...opts, json: true }) });
  return out;
}

export async function generateJSON<T>(schema: z.ZodType<T>, prompt: string, opts: { system?: string } = {}): Promise<T> {
  const shape = JSON.stringify(z.toJSONSchema(schema));
  const base = `${prompt}\n\nReturn ONLY a JSON object matching this JSON Schema:\n${shape}`;
  const errors: string[] = [];
  for (const { id, run } of jsonAttempts(opts)) {
    let feedback = "";
    for (let i = 0; i < 2; i++) {                                   // second try shows the model its validation error
      let raw: string;
      try { raw = (await run(base + feedback)).replace(/```json|```/g, "").trim(); }
      catch (e) { errors.push(e instanceof Error ? e.message : String(e)); break; }   // provider failed: next provider
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { feedback = "\n\nYour previous reply was not valid JSON. Reply with the JSON object only."; continue; }
      const res = schema.safeParse(parsed);
      if (res.success) return res.data;
      const issues = res.error.issues.slice(0, 6).map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      feedback = `\n\nYour previous reply did not match the schema (${issues}). Return the full corrected object.`;
      if (i === 1) errors.push(`${id}: JSON didn't match the schema after a retry`);
    }
  }
  throw new Error(`No LLM provider produced valid output: ${errors.map(e => clip(e, 90)).join(" | ")}`);
}
