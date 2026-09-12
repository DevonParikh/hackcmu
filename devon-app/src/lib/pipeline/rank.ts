import { z } from "zod";
import { isDemo, structured } from "../llm";
import { TEMPLATES, type TemplateContext } from "../templates";
import type { Assessment, Opportunity } from "../types";

const RationaleSchema = z.object({ items: z.array(z.object({ templateId: z.string(), rationale: z.string() })) });

export async function rankOpportunities(ctx: TemplateContext, assessment: Assessment, pain: string): Promise<Opportunity[]> {
  const painLower = pain.toLowerCase();
  // Signals that only note something is missing count for less than words on the site or from the owner.
  const ABSENCE = new Set(["no_faq_page", "no_lead_capture", "ecommerce_catalog", "support_by_email_only", "reviews_offsite"]);
  const scored: (Opportunity & { textual: number })[] = TEMPLATES.map((t) => {
    const matched = assessment.frictionSignals.filter((s) => s.id.split("+").some((id) => t.signalIds.includes(id)));
    const textual = matched.filter((s) => !s.id.split("+").every((id) => ABSENCE.has(id)));
    const keywordHit = t.keywords.some((k) => painLower.includes(k)) ? 1 : 0;
    const unmatchedPenalty = matched.length === 0 && !keywordHit ? 0.55 : 1;
    const impact = Math.min(1, t.impactBase * unmatchedPenalty * (1 + 0.35 * matched.length + 0.3 * keywordHit));
    const evidenceStrength = Math.min(1, textual.length * 0.45 + (matched.length - textual.length) * 0.2 + keywordHit * 0.3);
    const data = t.dataAvailability(ctx);
    const score = 0.4 * impact + 0.3 * evidenceStrength + 0.2 * data.score + 0.1 * (1 - t.adoptionEffort);
    const quotes = matched.flatMap((s) => s.evidence.filter((e) => !e.observed).map((e) => `"${e.quote.slice(0, 90)}"`)).slice(0, 2);
    const because = matched.length
      ? `Because of: ${matched.map((s) => s.task.toLowerCase()).join("; ")}${quotes.length ? `, e.g. ${quotes.join(" and ")}` : ""}.`
      : "No specific sign of this chore on the site; ranked on general fit.";
    return {
      templateId: t.id,
      score: round(score),
      impact: round(impact),
      evidenceStrength: round(evidenceStrength),
      dataAvailability: round(data.score),
      adoptionEffort: t.adoptionEffort,
      rationale: `${because} Data: ${data.reason}.`,
      fit: "possible" as const,
      textual: textual.length,
      signalsAddressed: matched.map((s) => s.id.split("+").find((id) => t.signalIds.includes(id)) ?? s.id),
    };
  }).sort((a, b) => b.score - a.score || b.evidenceStrength - a.evidenceStrength);

  const top: Opportunity[] = scored.slice(0, 3).map(({ textual, ...o }) => ({ ...o, fit: o.evidenceStrength >= 0.45 && textual > 0 ? "strong" : o.evidenceStrength >= 0.2 ? "possible" : "weak" }));
  if (isDemo()) return top;
  try {
    const written = await structured({
      schema: RationaleSchema,
      effort: "low",
      system: "Write a two-sentence 'why this' for each recommended tool, addressed to the business owner, in plain words. Quote or paraphrase the specific evidence given (a line from their site, a job post, what they told us). Use only the signals and data notes given. Do not add claims or generic benefits.",
      user: `Company: ${ctx.companyName}\nOwner's stated pain: ${pain || "none"}\nFriction signals: ${JSON.stringify(assessment.frictionSignals.map((s) => ({ id: s.id, task: s.task, evidence: s.evidence.map((e) => e.quote) })))}\nRecommendations: ${JSON.stringify(top.map((o) => ({ templateId: o.templateId, name: TEMPLATES.find((t) => t.id === o.templateId)?.name, signalsAddressed: o.signalsAddressed, dataNote: o.rationale })))}`,
    });
    for (const o of top) {
      const w = written.items.find((i) => i.templateId === o.templateId);
      if (w?.rationale) o.rationale = w.rationale;
    }
  } catch {
    /* keep deterministic rationale */
  }
  return top;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
