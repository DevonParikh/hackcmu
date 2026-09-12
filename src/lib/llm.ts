import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const MODELS = {
  main: process.env.TAILOR_MODEL_MAIN || "claude-opus-5",
  worker: process.env.TAILOR_MODEL_WORKER || "claude-sonnet-5",
  runtime: process.env.TAILOR_MODEL_RUNTIME || "claude-sonnet-5",
};

/** Demo mode: no API key (or forced). Crawling and MongoDB still run for real. */
export function isDemo(): boolean {
  return process.env.TAILOR_DEMO === "1" || !process.env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Haiku-class models reject the effort parameter, so it is only sent to models that take it. */
function effortFor(model: string, effort: Effort): { effort?: Effort } {
  return /haiku/i.test(model) ? {} : { effort };
}

function systemBlocks(system: string, cachedSystem?: string): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [];
  if (cachedSystem) blocks.push({ type: "text", text: cachedSystem, cache_control: { type: "ephemeral" } });
  blocks.push({ type: "text", text: system });
  return blocks;
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * One structured-output call validated against a zod schema. `cachedSystem` is a stable prefix
 * (the crawled corpus) placed first and cached, so the profile, assessment, and build stages of
 * one run share it instead of each paying for it.
 */
export async function structured<T>(opts: {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  cachedSystem?: string;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
}): Promise<T> {
  const model = opts.model ?? MODELS.main;
  const response = await getClient().messages.create({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    system: systemBlocks(opts.system, opts.cachedSystem),
    messages: [{ role: "user", content: opts.user }],
    output_config: { ...effortFor(model, opts.effort ?? "medium"), format: zodOutputFormat(opts.schema) },
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined this request (${response.stop_details?.category ?? "refusal"})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Claude's answer was cut off because it was too long. Try again with a smaller site or fewer documents.");
  }
  const text = textOf(response.content);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Claude returned something that was not valid JSON");
  }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) throw new Error(`Claude's answer did not match the expected shape: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return parsed.data;
}

/** Plain text completion. `system` may be split into a cached stable prefix and a volatile tail. */
export async function completeText(opts: {
  system: string;
  cachedSystem?: string;
  messages: Anthropic.MessageParam[];
  model?: string;
  effort?: Effort;
  maxTokens?: number;
}): Promise<string> {
  const model = opts.model ?? MODELS.main;
  const response = await getClient().messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4000,
    system: systemBlocks(opts.system, opts.cachedSystem),
    messages: opts.messages,
    output_config: effortFor(model, opts.effort ?? "low"),
  });
  if (response.stop_reason === "refusal") {
    return "I can't help with that one. Please contact us directly and a person will follow up.";
  }
  if (response.stop_reason === "max_tokens") return "";
  return textOf(response.content);
}

/**
 * Research with Anthropic's server-side web search and web fetch tools.
 * Loops on pause_turn until the model finishes, then returns its written notes.
 * Fetched pages are capped so a long page cannot dominate the context, and the loop is bounded.
 */
export async function research(opts: {
  prompt: string;
  model?: string;
  maxSearches?: number;
}): Promise<string> {
  const c = getClient();
  const model = opts.model ?? MODELS.worker;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
  const notes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const response = await c.messages.create({
      model,
      max_tokens: 12000,
      system:
        "You research small businesses on the public web. Work efficiently: a few searches, fetch only the official sites that matter, then finish with a consolidated list. For each competitor give the official website URL, one line on why it competes, what it offers, two strengths, two weaknesses, and where you found each fact. Only include businesses you actually found; never guess a URL.",
      messages,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 8 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, max_content_tokens: 20000 },
      ],
      output_config: effortFor(model, "medium"),
    });
    notes.push(textOf(response.content));
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    break;
  }
  return notes.filter(Boolean).join("\n\n");
}
