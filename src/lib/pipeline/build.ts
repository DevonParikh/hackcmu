import { z } from "zod";
import { isDemo, structured } from "../llm";
import { getTemplate, type TemplateContext } from "../templates";
import { answerChat, answerForm, retrieve, tokens } from "../runtime/chat";
import type { Brand, CompanyDoc, EvalCase, KnowledgeChunk, RunDoc, SourceDoc, ToolConfig, ToolDoc } from "../types";
import { now } from "../db";
import { buildCorpus } from "./corpus";

const PRIORITY = /faq|help|about|service|pricing|plan|menu|contact|hours|policy|book|product|shop/i;

export function buildKnowledge(srcs: SourceDoc[], maxChars = 60_000): KnowledgeChunk[] {
  const sorted = [...srcs].sort((a, b) => Number(PRIORITY.test(b.url + b.title)) - Number(PRIORITY.test(a.url + a.title)));
  const out: KnowledgeChunk[] = [];
  let used = 0;
  for (const s of sorted) {
    if (!s.text.trim()) continue;
    const text = s.text.slice(0, 6000);
    if (used + text.length > maxChars) break;
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
    tone: opts.tone || company.profile?.toneOfVoice || "Friendly and straightforward",
    offLimits: opts.offLimits,
  };
  const brand: Brand = company.brand;
  const knowledge = buildKnowledge(sources);
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
  log(`Running self-test with ${questions.length} questions`);
  const evals: EvalCase[] = [];
  for (const question of questions) {
    let answer = "";
    try {
      answer = template.mode === "form" ? await answerForm(tool, question) : await answerChat(tool, [], question);
    } catch (e) {
      answer = `ERROR: ${(e as Error).message}`;
    }
    evals.push(await grade(tool, question, answer));
  }
  tool.evals = evals;
  tool.evalSummary = { passed: evals.filter((e) => e.pass).length, total: evals.length };
  log(`Self-test: ${tool.evalSummary.passed}/${tool.evalSummary.total} passed`);
  return tool;
}

async function grade(tool: ToolDoc, question: string, answer: string): Promise<EvalCase> {
  if (answer.startsWith("ERROR:")) return { question, answer, pass: false, note: "The tool errored" };
  if (isDemo()) {
    const hit = retrieve(tool.config.knowledge, question);
    const escalates = /contact|email|call|reach us|not sure|couldn't find|person on our team|follow up/i.test(answer);
    const grounded = !!hit && tokens(answer).some((t) => tokens(hit.chunk.text).includes(t));
    if (tool.mode === "form") return { question, answer, pass: answer.length > 40, note: answer.length > 40 ? "Produced a complete draft" : "Draft too short" };
    if ((tool.templateId === "lead_intake" || tool.templateId === "booking_intake") && /could you share|i have what i need/i.test(answer)) {
      return { question, answer, pass: true, note: grounded ? `Collected intake details, grounded in "${hit!.chunk.title}"` : "Asked for the next intake detail" };
    }
    if (grounded) return { question, answer, pass: true, note: `Grounded in "${hit!.chunk.title}"` };
    if (escalates) return { question, answer, pass: true, note: "Not on the site; handed off to a person correctly" };
    return { question, answer, pass: false, note: "Neither grounded nor escalated" };
  }
  const verdict = await structured({
    schema: z.object({ pass: z.boolean(), note: z.string() }),
    effort: "low",
    system: "You grade a small business assistant. PASS if the answer is grounded in the knowledge (no invented facts), stays in scope, and either answers or hands off to a person when the knowledge lacks the answer. FAIL for invented prices/hours/policies, off-scope chatter, or ignoring the question. One-sentence note.",
    user: `KNOWLEDGE (truncated):\n${tool.config.knowledge.map((k) => `${k.title}: ${k.text.slice(0, 1200)}`).join("\n\n").slice(0, 30_000)}\n\nQUESTION: ${question}\nANSWER: ${answer}`,
  });
  return { question, answer, pass: verdict.pass, note: verdict.note };
}
