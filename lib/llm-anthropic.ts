// lib/llm-anthropic.ts — Claude as a provider in the chain (lib/llm.ts).
//
//   anthropicText(prompt, { grounding, system })  → prose; with grounding, Claude uses Anthropic's server-side web search
//   anthropicJSON(schema, prompt, { system })      → raw JSON text, produced with structured outputs when the schema allows it
//
// Configured by ANTHROPIC_API_KEY (or an `ant auth login` profile) and, optionally, ANTHROPIC_MODEL (default claude-opus-5).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const anthropicConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const anthropicModel = () => process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ timeout: 120_000, maxRetries: 2 }));

const textOf = (content: Anthropic.ContentBlock[]) =>
  content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n").trim();

/** Turns a Claude failure into one line for the chain's error list; marks the key dead when it is out of credit. */
export function anthropicError(e: unknown, dead: Set<string>): Error {
  if (e instanceof Anthropic.APIError) {
    if (e.status === 429 && /credit|billing|quota/i.test(e.message)) dead.add("anthropic");
    if (e instanceof Anthropic.AuthenticationError) dead.add("anthropic");
    return new Error(`Claude ${e.status ?? ""} (${anthropicModel()}): ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

export async function anthropicText(prompt: string, opts: { grounding?: boolean; system?: string } = {}): Promise<{ text: string; cites: string[] }> {
  const c = getClient();
  const model = anthropicModel();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const cites = new Set<string>();
  let text = "";
  // A web-search turn can pause; resume until Claude finishes, bounded so a runaway search cannot hang a run.
  for (let i = 0; i < 6; i++) {
    const res = await c.messages.create({
      model,
      max_tokens: 16000,
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.grounding ? { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }] } : {}),
      messages,
    });
    for (const block of res.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === "web_search_result" && r.url) cites.add(r.url);
      }
      if (block.type === "text") {
        for (const cit of block.citations ?? []) if (cit.type === "web_search_result_location" && cit.url) cites.add(cit.url);
      }
    }
    text = textOf(res.content);
    if (res.stop_reason === "refusal") throw new Error(`Claude declined this request (${res.stop_details?.category ?? "refusal"})`);
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  return { text, cites: [...cites] };
}

export async function anthropicJSON<T>(schema: z.ZodType<T>, prompt: string, opts: { system?: string } = {}): Promise<string> {
  const c = getClient();
  const model = anthropicModel();
  const base = { model, max_tokens: 16000, ...(opts.system ? { system: opts.system } : {}), messages: [{ role: "user" as const, content: prompt }] };
  let res: Anthropic.Message;
  try {
    res = await c.messages.create({ ...base, output_config: { format: zodOutputFormat(schema) } });
  } catch (e) {
    // A schema feature structured outputs cannot express (some zod constraints) comes back as a 400: fall back to
    // plain JSON, which lib/llm.ts validates and retries the same way it does for every other provider.
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    res = await c.messages.create({ ...base, system: `${opts.system ? opts.system + "\n\n" : ""}Reply with a single JSON object and nothing else.` });
  }
  if (res.stop_reason === "refusal") throw new Error(`Claude declined this request (${res.stop_details?.category ?? "refusal"})`);
  if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off because it was too long");
  return textOf(res.content);
}
