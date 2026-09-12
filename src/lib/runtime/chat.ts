import type Anthropic from "@anthropic-ai/sdk";
import { completeText, isDemo, MODELS } from "../llm";
import { getTemplate } from "../templates";
import type { KnowledgeChunk, ToolDoc } from "../types";

const STOP = new Set("a an the and or of to in on for with is are be at by from this that it as your our you we my me i do does can how what where when why which who will its their there here about have has had not no yes please thanks".split(" "));

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9$.\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function knowledgeText(chunks: KnowledgeChunk[]): string {
  return chunks.map((c, i) => `### [${i + 1}] ${c.title}\nURL: ${c.url}\n${c.text}`).join("\n\n");
}

/** Deterministic retrieval used in demo mode and as a fallback. */
export function retrieve(chunks: KnowledgeChunk[], query: string): { chunk: KnowledgeChunk; sentences: string[]; score: number } | null {
  const q = tokens(query);
  if (!q.length || !chunks.length) return null;
  const df = new Map<string, number>();
  for (const c of chunks) for (const t of new Set(tokens(c.text + " " + c.title))) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + chunks.length / (df.get(t) ?? 0.5));
  let best: { chunk: KnowledgeChunk; score: number } | null = null;
  for (const c of chunks) {
    const ct = new Set(tokens(c.text + " " + c.title));
    let s = 0;
    for (const t of q) if (ct.has(t)) s += idf(t);
    if (!best || s > best.score) best = { chunk: c, score: s };
  }
  if (!best || best.score === 0) return null;
  const sentences = best.chunk.text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 15)
    .map((x) => ({ x, s: q.reduce((n, t) => n + (x.toLowerCase().includes(t) ? idf(t) : 0), 0) / Math.log(20 + x.length) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((r) => r.x.slice(0, 280));
  return { chunk: best.chunk, sentences, score: best.score };
}

function escalation(tool: ToolDoc): string {
  const c = tool.config.escalation;
  const parts = [c.email && `email ${c.email}`, c.phone && `call ${c.phone}`].filter(Boolean);
  return parts.length ? `You can also ${parts.join(" or ")}.` : "You can also reach us through the contact page.";
}

export async function answerChat(tool: ToolDoc, history: { role: "user" | "assistant"; content: string }[], userMessage: string): Promise<string> {
  if (isDemo()) return demoChat(tool, userMessage);
  const messages: Anthropic.MessageParam[] = [...history.slice(-12).map((m) => ({ role: m.role, content: m.content })), { role: "user", content: userMessage }];
  return completeText({
    model: MODELS.runtime,
    cachedSystem: `${tool.config.systemPrompt}\n\nKNOWLEDGE:\n${knowledgeText(tool.config.knowledge)}`,
    system: "Answer the latest user message. If you are not sure, say so and share the contact options.",
    messages,
    effort: "low",
    maxTokens: 800,
  });
}

export async function answerForm(tool: ToolDoc, input: string): Promise<string> {
  if (isDemo()) return demoForm(tool, input);
  return completeText({
    model: MODELS.runtime,
    cachedSystem: `${tool.config.systemPrompt}\n\nKNOWLEDGE:\n${knowledgeText(tool.config.knowledge)}`,
    system: "Produce the requested output for the input below. Output only the result.",
    messages: [{ role: "user", content: input }],
    effort: "low",
    maxTokens: 800,
  });
}

function demoChat(tool: ToolDoc, userMessage: string): string {
  const t = getTemplate(tool.templateId);
  const name = tool.config.name;
  const hit = retrieve(tool.config.knowledge, userMessage);
  const lower = userMessage.toLowerCase();
  if (tool.config.offLimits.some((o) => lower.includes(o.toLowerCase()))) return `I can't help with that here. ${escalation(tool)}`;
  const wantsHuman = /refund|complain|lawsuit|medical|legal|emergency|manager|human|person/.test(lower);
  if (wantsHuman) return `That's one for a person on our team. ${escalation(tool)}`;
  if (t?.id === "lead_intake" || t?.id === "booking_intake") {
    const asks = t.id === "lead_intake"
      ? ["your name", "what you need", "when you need it", "a rough budget", "the best way to reach you"]
      : ["the service you'd like", "a preferred date and time (plus one alternative)", "your name", "a phone number or email"];
    const answered = asks.filter((a) => tokens(a).some((k) => lower.includes(k)));
    const next = asks.find((a) => !answered.includes(a)) ?? null;
    const fact = hit && hit.sentences.length ? ` From our site: ${hit.sentences[0]}` : "";
    if (!next) return `Thanks, I have what I need. Someone from ${name.replace(/ assistant$/i, "")} will follow up. ${escalation(tool)}`;
    return `Got it.${fact} Could you share ${next}?`;
  }
  if (!hit || !hit.sentences.length) return `I couldn't find that on our site yet. ${escalation(tool)}`;
  return `${hit.sentences.join(" ")} (Source: ${hit.chunk.title})`;
}

function demoForm(tool: ToolDoc, input: string): string {
  const company = tool.config.name.replace(/ (assistant|writer|responder|bot)$/i, "");
  if (tool.templateId === "review_responder") {
    const negative = /disappoint|never|waited|slow|rude|bad|terrible|confus|two stars|one star|\b[12] star/i.test(input);
    const topic = tokens(input).slice(0, 4).join(", ");
    return negative
      ? `Thank you for telling us about this. We're sorry the experience fell short, and we hear you on ${topic || "the points you raised"}. That isn't the standard we hold ourselves to, and we'd like to make it right. ${escalation(tool)} We'd welcome the chance to talk it through directly. — The ${company} team`
      : `Thank you so much for the kind words! We're glad ${topic ? `the ${topic} ` : ""}stood out, and we'll pass this along to the team. We look forward to seeing you again soon. — The ${company} team`;
  }
  if (tool.templateId === "listing_writer") {
    const parts = input.split(/,|\n/).map((p) => p.trim()).filter(Boolean);
    const title = parts[0] ? parts[0].slice(0, 70) : "New product";
    const price = parts.find((p) => /\$\s?\d/.test(p));
    const rest = parts.slice(1).filter((p) => p !== price);
    return `Title: ${title}\n\nDescription: ${title} from ${company}. ${rest.length ? `Made with ${rest.join(", ")}.` : ""} ${price ? `Available for ${price}.` : ""} Crafted to fit the way you live, it's ready to enjoy the moment it arrives.\n\nHighlights:\n- ${rest[0] ?? title}\n- ${rest[1] ?? "Made with care"}\n- ${price ?? "Ships fast"}`;
  }
  return demoChat(tool, input);
}
