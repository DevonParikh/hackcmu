// lib/gemini.ts — two calls, model-agnostic in spirit.
//   generateText(prompt, { grounding })  → prose, optionally with Google Search available to the model
//   generateJSON(schema, prompt)          → an object validated by zod, retried once with the validation error
//
// Grounding and JSON mode can't be combined in one Gemini call, so stages that need both do two calls:
// a grounded text call, then a JSON call that structures the notes.

import { z } from "zod";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Primary, then a fallback for when the newest model is overloaded (503) or rate-limited (429).
function models(): string[] {
  const a = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
  const b = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash";
  return a === b ? [a] : [a, b];
}

type Body = Record<string, unknown>;

async function call(body: Body): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  let last: Error = new Error("Gemini: no attempts made");
  for (const model of models()) {
    for (let i = 0; i < 3; i++) {                       // 3 tries per model: 1.5s, 3s, 6s between
      const r = await fetch(`${BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
      if (r.ok) return r.json();
      last = new Error(`Gemini ${r.status} (${model}): ${(await r.text()).replace(/\s+/g, " ").slice(0, 160)}`);
      if (r.status === 404) break;                      // unknown model name: try the next model
      if (r.status < 500 && r.status !== 429) throw last; // a bad request won't get better
      await sleep(1500 * 2 ** i);
    }
  }
  throw last;
}

const textOf = (data: any): string =>
  (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("");

export async function generateText(
  prompt: string,
  opts: { grounding?: boolean; system?: string; temperature?: number } = {},
): Promise<{ text: string; cites: string[] }> {
  const body: Body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: opts.temperature ?? 0.2 },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.grounding) body.tools = [{ google_search: {} }];
  const data = await call(body);
  const cites: string[] = (data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
    .map((c: any) => c?.web?.uri).filter(Boolean);
  return { text: textOf(data), cites };
}

export async function generateJSON<T>(
  schema: z.ZodType<T>,
  prompt: string,
  opts: { system?: string } = {},
): Promise<T> {
  const shape = JSON.stringify(z.toJSONSchema(schema));
  let feedback = "";
  for (let i = 0; i < 2; i++) {
    const body: Body = {
      contents: [{ role: "user", parts: [{ text: `${prompt}\n\nReturn ONLY a JSON object matching this JSON Schema:\n${shape}${feedback}` }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    const raw = textOf(await call(body)).replace(/```json|```/g, "").trim();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { feedback = "\n\nYour previous reply was not valid JSON. Reply with the JSON object only."; continue; }
    const res = schema.safeParse(parsed);
    if (res.success) return res.data;
    const issues = res.error.issues.slice(0, 6).map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    feedback = `\n\nYour previous reply did not match the schema (${issues}). Return the full corrected object.`;
  }
  throw new Error("Gemini returned JSON that did not match the schema after a retry");
}
