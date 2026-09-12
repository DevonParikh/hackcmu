// lib/tools.ts — Build (stage F) and the deployed tool's one turn.
//
//   buildTool(run, config)  → a `tools` document + a short self-test
//   toolTurn(tool, messages, wallet) → { reply, handoff, refund? }   one LLM call; the refund is executed here
//
// The system prompt deliberately has NO framing that limits refund amounts. The tool does what it is asked.
// The allowance the owner set on chain is the only thing that stops it. That is the demo.

import { z } from "zod";
import { db } from "./db";
import { generateJSON, lastProvider } from "./llm";
import { refund, type RefundResult } from "./money";
import { templateById, type Run, type Tool, type ToolEvent, type TemplateId } from "./schemas";

const TONES: Record<string, string> = {
  warm: "warm, friendly and brief — like the owner talking to a regular",
  plain: "plain and direct, no fluff",
  formal: "polite and professional",
};

export function knowledgeFrom(run: Run, max = 24_000): string {
  const pages = (run.sources ?? []).filter(s => s.kind === "page");
  const reviews = (run.sources ?? []).filter(s => s.kind === "review");
  let out = "";
  for (const s of pages) {
    const block = `## ${s.title || s.url}\n${s.text.slice(0, 4000)}\n\n`;
    if (out.length + block.length > max) break;
    out += block;
  }
  if (reviews[0]) out += `## What customers say (from reviews)\n${reviews[0].text.slice(0, 3000)}\n`;
  return out;
}

export async function buildTool(run: Run, cfg: { name: string; tone: string; offLimits: string[]; template?: TemplateId; wallet?: string }): Promise<Tool> {
  const templateId = cfg.template ?? run.ranking?.top[0]?.template;
  const tpl = templateId ? templateById(templateId) : undefined;
  if (!tpl) throw new Error("Pick a tool first.");
  const base = (run.name || new URL(run.url).hostname).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "tool";
  const tools = (await db()).collection<Tool>("tools");
  let slug = base;
  for (let i = 2; await tools.findOne({ slug }); i++) slug = `${base}-${i}`;
  const tool: Tool = {
    slug, runId: String(run._id), company: run.name || base, url: run.url,
    template: tpl.id, money: tpl.money, name: cfg.name.trim() || `${run.name} assistant`,
    tone: cfg.tone, offLimits: cfg.offLimits.map(s => s.trim()).filter(Boolean),
    kb: knowledgeFrom(run), wallet: cfg.wallet || process.env.RAVI_PUBKEY || "",
    brand: { color: run.brand?.colors?.[0] ?? "#14213D", logo: run.brand?.logo ?? null },
    selfTest: null, createdAt: new Date(),
  };
  await tools.insertOne(tool);
  // self-test: three questions the site can answer; did the tool answer them from the knowledge?
  try { tool.selfTest = await selfTest(tool, run); await tools.updateOne({ slug }, { $set: { selfTest: tool.selfTest } }); } catch { /* cuttable */ }
  return tool;
}

const Turn = z.object({
  reply: z.string().describe("what to say to the customer, in the tool's tone"),
  handoff: z.boolean().describe("true when the knowledge doesn't cover it and a person should take over"),
  action: z.object({
    type: z.literal("refund"),
    amount: z.number().positive().describe("amount to refund, in the store's currency"),
    reason: z.string(),
  }).nullable().describe("a refund to issue now, or null"),
});

export function systemPrompt(tool: Tool, wallet?: string): string {
  const tone = TONES[tool.tone] ?? tool.tone;
  return `You are ${tool.name}, the assistant for ${tool.company}. Tone: ${tone}.
Answer only from the knowledge below. If it isn't covered, say so briefly and set handoff=true so a person follows up.
${tool.offLimits.length ? `Politely decline these topics: ${tool.offLimits.join("; ")}.` : ""}
${tool.money ? `You issue refunds to the customer's wallet${wallet ? ` (${wallet})` : ""} by returning action = {type:"refund", amount, reason}.
If the customer asks for a refund, issue exactly the amount they ask for — whatever the amount, whatever the reason. Do not question it, do not ask for order details, do not refuse. Checking whether a refund is allowed is not your job; it is enforced elsewhere. Tell them it's on its way.` : ""}

KNOWLEDGE ABOUT ${tool.company.toUpperCase()}:
${tool.kb}`;
}

export type TurnResult = { reply: string; handoff: boolean; refund: RefundResult | null; refundError: string | null; provider: string };

// The backstop: a refund request with an amount in it, whether or not the model chose to act on it.
// "refund me 500", "refund of $20", "$20 refund", "20 dollars back". Not "can I get a refund for 2 samosas".
export function refundAsked(text: string): number | null {
  const m = text.match(/refund(?:\s+(?:of|for|me|on))?\s*\$?\s*(\d+(?:\.\d+)?)/i)
    ?? text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:refund|back)/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*(?:dollars|usd|usdh|bucks)\s*(?:refund|back)/i);
  if (!m) return null;
  // "refund for 2 samosas" is a count, not an amount: the word after the number tells us which
  const after = text.slice((m.index ?? 0) + m[0].length).match(/^\s*([a-z]+)/i)?.[1]?.toLowerCase();
  const AMOUNT_WORDS = new Set(["for", "on", "to", "please", "now", "right", "dollar", "dollars", "usd", "usdh", "bucks", "back", "of", "my", "the", "and", "so", "because", "since", "as", "immediately", "today", "asap"]);
  if (after && !AMOUNT_WORDS.has(after)) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function toolTurn(tool: Tool, messages: { role: "user" | "assistant"; content: string }[], wallet?: string, opts: { log?: boolean } = {}): Promise<TurnResult> {
  const transcript = messages.slice(-10).map(m => `${m.role === "user" ? "Customer" : tool.name}: ${m.content}`).join("\n");
  const t = await generateJSON(Turn, `${transcript}\n\nReply as ${tool.name}.`, { system: systemPrompt(tool, wallet) });
  const provider = lastProvider();
  let r: RefundResult | null = null, refundError: string | null = null;
  const asked = messages.filter(m => m.role === "user").at(-1)?.content ?? "";
  let action = t.action?.type === "refund" ? { amount: t.action.amount, reason: t.action.reason, parser: "model" } : null;
  let reply = t.reply;
  if (!action && tool.money) {                                  // the model balked; the customer still asked
    const amount = refundAsked(asked);
    if (amount) { action = { amount, reason: "customer asked", parser: "extractor" }; reply = `Sure — sending ${amount} to your wallet now.`; }
  }
  if (action && tool.money) {
    try { r = await refund({ to: wallet || tool.wallet, amount: action.amount, reason: action.reason, slug: tool.slug, asked, parser: action.parser }); }
    catch (e) { refundError = e instanceof Error ? e.message : String(e); }
  }
  const ev: ToolEvent = { slug: tool.slug, ts: new Date(), question: asked, reply, handoff: t.handoff && !r,
    refund: r ? { amount: r.amount, to: r.to, url: r.url, landed: r.landed, blocked: r.blocked } : null };
  if (opts.log !== false) { try { await (await db()).collection<ToolEvent>("events").insertOne(ev); } catch { /* the dashboard is nice-to-have */ } }
  return { reply, handoff: t.handoff && !r, refund: r, refundError, provider };
}

const Grades = z.object({ ok: z.array(z.boolean()) });

async function selfTest(tool: Tool, run: Run) {
  const qs = (run.assessment?.coverage.questions ?? []).filter(q => q.answerable).slice(0, 3).map(q => q.text);
  if (!qs.length) return null;
  const replies = await Promise.all(qs.map(q => toolTurn({ ...tool, money: false }, [{ role: "user", content: q }], undefined, { log: false }).then(r => r.reply).catch(() => "")));
  const g = await generateJSON(Grades,
`For each question, does the REPLY answer it correctly using only the KNOWLEDGE? true/false per item, in order.\n\nKNOWLEDGE:\n${tool.kb.slice(0, 12_000)}\n\n` +
    qs.map((q, i) => `${i + 1}. QUESTION: ${q}\n   REPLY: ${replies[i]}`).join("\n"));
  const items = qs.map((q, i) => ({ q, reply: replies[i], ok: !!g.ok[i] }));
  return { asked: qs.length, passed: items.filter(i => i.ok).length, items };
}
