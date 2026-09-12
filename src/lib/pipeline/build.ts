import { z } from "zod";
import { isDemo, structured } from "../llm";
import { getTemplate, type TemplateContext } from "../templates";
import { INTENTS, answerChat, answerForm, knowledgeText, retrieve, tokens } from "../runtime/chat";
import type { Brand, CompanyDoc, EvalCase, KnowledgeChunk, RunDoc, SourceDoc, ToolConfig, ToolDoc } from "../types";
import { now } from "../db";
import { buildCorpus } from "./corpus";

const PRIORITY = /faq|help|about|service|pricing|plan|menu|contact|hours|policy|book|product|shop/i;

export function buildKnowledge(srcs: SourceDoc[], homeUrl: string, opts: { staffTool?: boolean; maxChars?: number } = {}): KnowledgeChunk[] {
  const maxChars = opts.maxChars ?? 60_000;
  const isHome = (s: SourceDoc) => s.url.replace(/\/$/, "") === homeUrl.replace(/\/$/, "");
  const rank = (s: SourceDoc) => (isHome(s) ? 3 : s.kind === "user" ? 2 : PRIORITY.test(s.url + " " + s.title) ? 1 : 0);
  // Staff-only uploads and job postings never reach customer-facing tools.
  const eligible = srcs.filter((s) => (s.kind !== "user" || s.audience !== "staff" || opts.staffTool) && (s.kind !== "job" || opts.staffTool));
  const sorted = [...eligible].sort((a, b) => rank(b) - rank(a));
  const out: KnowledgeChunk[] = [];
  let used = 0;
  for (const s of sorted) {
    if (!s.text.trim()) continue;
    const remaining = maxChars - used;
    if (remaining < 400) break;
    const text = s.text.slice(0, Math.min(6000, remaining));
    used += text.length;
    out.push({ title: s.title, url: s.url, text });
  }
  return out;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "company";
}

export async function buildTool(opts: {
  company: CompanyDoc;
  run: RunDoc;
  sources: SourceDoc[];
  templateId: string;
  name: string;
  tone: string;
  offLimits: string[];
  log: (msg: string) => void;
}): Promise<ToolDoc> {
  const { company, run, sources, templateId, log } = opts;
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template ${templateId}`);
  const ctx: TemplateContext = {
    companyName: company.name,
    url: company.url,
    profile: company.profile,
    features: company.features ?? ({} as CompanyDoc["features"] & object),
    contact: company.contact,
    signals: run.assessment?.frictionSignals ?? [],
    pageTitles: sources.map((s) => s.title),
    pageCount: sources.length,
    text: sources.map((s) => s.text).join("\n").toLowerCase().slice(0, 200_000),
    tone: opts.tone || company.profile?.toneOfVoice || "Friendly and straightforward",
    offLimits: opts.offLimits,
  };
  const brand: Brand = company.brand;
  const knowledge = buildKnowledge(sources, company.url, { staffTool: templateId === "staff_assistant" });
  const ownerQuestions = (run.intake?.topQuestions ?? []).filter(Boolean);
  const config: ToolConfig = {
    name: opts.name || `${company.name} ${template.name.split(" ")[0].toLowerCase()} assistant`.replace(/assistant assistant$/, "assistant"),
    tone: ctx.tone,
    offLimits: opts.offLimits,
    escalation: company.contact,
    brand,
    systemPrompt: template.systemPrompt(ctx),
    knowledge,
    placeholder: template.placeholder,
    greeting: template.greeting(ctx),
    about: [company.profile?.tagline, company.profile?.offering].filter(Boolean).join(" "),
    suggestedQuestions: [],
    companyName: company.name,
  };
  const slug = `${slugify(company.name)}-${templateId.replace(/_/g, "-")}-${crypto.randomUUID().slice(0, 4)}`;
  const tool: ToolDoc = {
    _id: slug,
    companyId: company._id,
    runId: run._id,
    templateId,
    mode: template.mode,
    config,
    evals: [],
    evalSummary: { passed: 0, total: 0 },
    createdAt: now(),
  };
  log(`Assembled ${template.name} with ${knowledge.length} knowledge chunks`);

  // ----- Self-test -----
  let questions = template.sampleQuestions(ctx);
  if (!isDemo()) {
    try {
      const q = await structured({
        schema: z.object({ questions: z.array(z.string()).min(6).max(10) }),
        effort: "low",
        system: `Write 10 realistic messages a real ${template.mode === "form" ? "staff member" : "customer"} would send to this tool, drawn from the company's own pages (services, hours, policies, reviews). Mix easy and hard; include one the site cannot answer.`,
        user: `Tool: ${template.name} — ${template.summary}\nCompany: ${company.name}\n\nSOURCES:\n${buildCorpus(sources, 40_000)}`,
      });
      questions = q.questions;
    } catch (e) {
      log(`Could not generate custom test questions (${(e as Error).message}); using defaults`);
    }
  }
  // The owner's own most-asked questions go first (starred); generated ones fill the rest.
  if (template.mode === "chat" && ownerQuestions.length) {
    questions = [...ownerQuestions, ...questions.filter((q) => !ownerQuestions.includes(q))].slice(0, 10);
  }
  tool.config.suggestedQuestions = questions.slice(0, 4);
  log(`Running self-test with ${questions.length} questions${ownerQuestions.length ? ` (${Math.min(ownerQuestions.length, 10)} of them yours)` : ""}`);
  const evals: EvalCase[] = [];
  for (const question of questions) {
    let answer = "";
    const started = Date.now();
    try {
      answer = template.mode === "form" ? await answerForm(tool, question) : await answerChat(tool, [], question);
    } catch (e) {
      answer = `ERROR: ${(e as Error).message}`;
    }
    const latencyMs = Date.now() - started;
    const graded = await grade(tool, question, answer);
    evals.push({ ...graded, latencyMs, starred: ownerQuestions.includes(question) });
  }
  tool.evals = evals;
  tool.evalSummary = { passed: evals.filter((e) => e.pass).length, total: evals.length };
  const answered = evals.filter((e) => e.outcome === "answered").length;
  const handed = evals.filter((e) => e.outcome === "handed_off").length;
  log(`Self-test: ${answered} answered, ${handed} handed to a person, ${evals.length - answered - handed} failed (of ${evals.length})`);
  return tool;
}

type Graded = Omit<EvalCase, "latencyMs" | "starred">;

async function grade(tool: ToolDoc, question: string, answer: string): Promise<Graded> {
  if (answer.startsWith("ERROR:")) return { question, answer, pass: false, note: "The tool errored", outcome: "failed" };
  if (isDemo()) {
    if (tool.mode === "form") return { question, answer, pass: answer.length > 40, note: answer.length > 40 ? "Produced a complete draft" : "Draft too short", outcome: answer.length > 40 ? "answered" : "failed" };
    const escalates = /contact|email|call|reach us|not sure|couldn't find|person on our team|follow up|can't help/i.test(answer);
    const qTokens = tokens(question);
    const lowerQ = question.toLowerCase();
    const lowerA = answer.toLowerCase();
    // Relevance, not provenance: the answer must share meaningful words (or the intent's
    // vocabulary) with the question, and the quoted sentences must come from a matching page.
    const baseHits = qTokens.filter((t) => lowerA.includes(t)).length;
    const expansions = INTENTS.filter(([re]) => re.test(lowerQ)).flatMap(([, w]) => w);
    const expansionHits = new Set(expansions.filter((t) => (t === "$" ? answer.includes("$") : new RegExp(`\\b${t}\\b`).test(lowerA)))).size;
    const relevanceScore = baseHits + 0.5 * expansionHits + (expansions.includes("$") && answer.includes("$") ? 0.5 : 0);
    const hit = retrieve(tool.config.knowledge, question);
    const factual = /^(We're located at|You can (call|email))/.test(answer) || (!!tool.config.about && answer === tool.config.about);
    const relevant = factual || (relevanceScore >= 1 && !!hit && hit.score >= 1);
    const asserted = factual || /\(Source: /.test(answer);
    if ((tool.templateId === "lead_intake" || tool.templateId === "booking_intake") && /could you share|i have what i need/i.test(answer)) {
      return { question, answer, pass: true, note: relevant ? `Collected intake details and used "${hit!.chunk.title}"` : "Asked for the next intake detail", outcome: "answered" };
    }
    if (asserted && relevant) return { question, answer, pass: true, note: factual ? "Answered from the business details on the site" : `Answered from "${hit!.chunk.title}"`, outcome: "answered" };
    if (asserted && !relevant) return { question, answer, pass: false, note: "Quoted the site, but the quote does not match the question", outcome: "failed" };
    if (escalates) return { question, answer, pass: true, note: "Not on the site; handed to a person with your contact details", outcome: "handed_off" };
    return { question, answer, pass: false, note: "Neither answered from the site nor handed off", outcome: "failed" };
  }
  const verdict = await structured({
    schema: z.object({ outcome: z.enum(["answered", "handed_off", "failed"]), note: z.string() }),
    effort: "low",
    system:
      "You grade a small business assistant. outcome 'answered' when the reply answers the question using only facts in KNOWLEDGE (for intake tools: it asked for or collected the next needed detail). 'handed_off' when KNOWLEDGE lacks the answer and the reply says so and offers the business's contact details. 'failed' for invented prices, hours, or policies, off-scope chatter, ignoring the question, or an error. One-sentence note in plain words.",
    user: `KNOWLEDGE (exactly what the assistant could see):\n${knowledgeText(tool.config.knowledge)}\n\nQUESTION: ${question}\nANSWER: ${answer}`,
  });
  return { question, answer, pass: verdict.outcome !== "failed", note: verdict.note, outcome: verdict.outcome };
}
