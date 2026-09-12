// lib/llm.ts — one interface, several providers, so a quota error is a log line and not a dead demo.
//
//   generateText(prompt, { grounding })  → prose; with grounding, the provider searches the web
//   generateJSON(schema, prompt)          → zod-validated object, one corrective retry per provider
//
// Order: Claude (ANTHROPIC_API_KEY) first when configured, then every Gemini key in GEMINI_API_KEYS (comma-separated;
// falls back to GEMINI_API_KEY), then xAI (XAI_API_KEY), then any OpenAI-compatible endpoint (OPENAI_API_KEY + OPENAI_BASE_URL),
// then IFM. A provider that answers 429 "quota" is skipped for the rest of the process. lastProvider() says who answered.

import { z } from "zod";
import { anthropicConfigured, anthropicError, anthropicJSON, anthropicModel, anthropicText } from "./llm-anthropic";
import { openaiChat, openaiConfigured, openaiModel } from "./llm-openai";

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
const ifmKey    = () => process.env.IFM_API_KEY;
const ifmBase   = () => (process.env.IFM_BASE_URL ?? "https://platform.ifm.ai/v1").replace(/\/$/, "");
const ifmModel  = () => process.env.IFM_MODEL ?? "IFM/K2-Horizon-7B";
const xaiModels = () => { const a = process.env.XAI_MODEL ?? "grok-4.20-non-reasoning"; return a === "grok-4.3" ? [a] : [a, "grok-4.3"]; };

const dead = new Set<string>();                  // provider ids exhausted this process
let last = "";
export const lastProvider = () => last;

/** Human-readable list of the providers this server has keys for, in the order they are tried. Empty means analysis cannot run. */
export function providersConfigured(): string[] {
  const out: string[] = [];
  if (anthropicConfigured()) out.push(`Claude (${anthropicModel()})`);
  if (geminiKeys().length) out.push(`Gemini (${geminiModels()[0]})`);
  if (xaiKey()) out.push(`Grok (${xaiModels()[0]})`);
  if (openaiConfigured()) out.push(`${process.env.OPENAI_BASE_URL ? new URL(process.env.OPENAI_BASE_URL).hostname : "OpenAI"} (${openaiModel()})`);
  if (ifmKey()) out.push(`IFM (${ifmModel()})`);
  return out;
}

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

// ---------------------------------------------------------------- ifm (K2 Horizon), OpenAI-compatible
// K2 returns its thinking in reasoning_content and the answer in content. reasoning_effort is passed through
// chat_template_kwargs where the gateway supports it; if the gateway rejects extras, retry plain.
async function ifmChat(prompt: string, opts: { json?: boolean; system?: string }): Promise<string> {
  const key = ifmKey(); if (!key) throw new Error("IFM_API_KEY not set");
  if (dead.has("ifm")) throw new Error("ifm exhausted");
  const model = ifmModel();
  const messages = [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content: prompt }];
  const bodies: Record<string, unknown>[] = [
    { model, messages, temperature: opts.json ? 0 : 0.2, max_tokens: 4096, chat_template_kwargs: { reasoning_effort: "low" }, ...(opts.json ? { response_format: { type: "json_object" } } : {}) },
    { model, messages, temperature: opts.json ? 0 : 0.2, max_tokens: 4096 },   // plain, for strict gateways
  ];
  let lastErr = new Error("ifm: no attempts");
  for (const body of bodies) {
    const r = await fetch(`${ifmBase()}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) {
      const data = await r.json();
      last = `IFM ${model}`;
      const m = data?.choices?.[0]?.message ?? {};
      return (m.content ?? "").trim() || (m.reasoning_content ?? "");
    }
    const text = await r.text();
    lastErr = new Error(`IFM ${r.status} (${model}): ${clip(text)}`);
    if (r.status === 429 && /quota|billing|credit/i.test(text)) { dead.add("ifm"); throw lastErr; }
    if (r.status !== 400) throw lastErr;                        // only a 400 (unknown field) earns the plain retry
  }
  throw lastErr;
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
  if (anthropicConfigured() && !dead.has("anthropic"))
    out.push(async () => {
      try { const r = await anthropicText(prompt, opts); last = `Claude ${anthropicModel()}${opts.grounding ? " + web search" : ""}`; return r; }
      catch (e) { throw anthropicError(e, dead); }
    });
  for (const key of geminiKeys()) for (const model of geminiModels())
    out.push(async () => { const [text, cites] = (await geminiOnce(key, model, geminiBody(prompt, opts))).split("\u0000"); return { text, cites: JSON.parse(cites || "[]") }; });
  if (xaiKey()) for (const model of xaiModels())
    out.push(() => opts.grounding ? xaiSearch(model, prompt) : xaiChat(model, prompt, { system: opts.system }).then(text => ({ text, cites: [] })));
  if (openaiConfigured() && !opts.grounding)                    // no web search on the generic endpoint; plain text only
    out.push(() => openaiChat(prompt, { system: opts.system }, dead).then(text => { last = openaiModel(); return { text, cites: [] }; }));
  if (ifmKey() && !opts.grounding)                              // K2 has no web search; plain text only
    out.push(() => ifmChat(prompt, { system: opts.system }).then(text => ({ text, cites: [] })));
  return out;
}

export async function generateText(prompt: string, opts: { grounding?: boolean; system?: string } = {}): Promise<{ text: string; cites: string[] }> {
  const errors: string[] = [];
  const attempts = textAttempts(prompt, opts);
  if (!attempts.length) throw new Error("No AI provider is configured. Set ANTHROPIC_API_KEY (or GEMINI_API_KEY, XAI_API_KEY, OPENAI_API_KEY) in .env.local and restart.");
  for (const attempt of attempts) {
    try { return await attempt(); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  throw new Error(`No LLM provider could answer: ${errors.map(e => clip(e, 90)).join(" | ")}`);
}

type JsonAttempt = (prompt: string) => Promise<string>;

function jsonAttempts<T>(schema: z.ZodType<T>, opts: { system?: string; prefer?: "ifm" }): { id: string; run: JsonAttempt }[] {
  const out: { id: string; run: JsonAttempt }[] = [];
  const ifm = { id: `IFM ${ifmModel()}`, run: (p: string) => ifmChat(p, { ...opts, json: true }) };
  if (ifmKey() && opts.prefer === "ifm") out.push(ifm);       // the evidence judge runs on K2 first
  if (anthropicConfigured() && !dead.has("anthropic"))
    out.push({ id: `Claude ${anthropicModel()}`, run: async p => {
      try { const r = await anthropicJSON(schema, p, { system: opts.system }); last = `Claude ${anthropicModel()}`; return r; }
      catch (e) { throw anthropicError(e, dead); }
    } });
  for (const key of geminiKeys()) for (const model of geminiModels())
    out.push({ id: `Gemini ${model}`, run: async p => (await geminiOnce(key, model, geminiBody(p, { ...opts, json: true }))).split("\u0000")[0] });
  if (xaiKey()) for (const model of xaiModels())
    out.push({ id: `Grok ${model}`, run: p => xaiChat(model, p, { ...opts, json: true }) });
  if (openaiConfigured())
    out.push({ id: openaiModel(), run: p => openaiChat(p, { ...opts, json: true }, dead).then(t => { last = openaiModel(); return t; }) });
  if (ifmKey() && opts.prefer !== "ifm") out.push(ifm);
  return out;
}

export async function generateJSON<T>(schema: z.ZodType<T>, prompt: string, opts: { system?: string; prefer?: "ifm" } = {}): Promise<T> {
  const shape = JSON.stringify(z.toJSONSchema(schema));
  const base = `${prompt}\n\nReturn ONLY a JSON object matching this JSON Schema:\n${shape}`;
  const errors: string[] = [];
  const attempts = jsonAttempts(schema, opts);
  if (!attempts.length) throw new Error("No AI provider is configured. Set ANTHROPIC_API_KEY (or GEMINI_API_KEY, XAI_API_KEY, OPENAI_API_KEY) in .env.local and restart.");
  for (const { id, run } of attempts) {
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
