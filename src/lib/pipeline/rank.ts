import { z } from "zod";
import { isDemo, structured } from "../llm";
import { TEMPLATES, type TemplateContext } from "../templates";
import type { Assessment, Opportunity } from "../types";

const RationaleSchema = z.object({ items: z.array(z.object({ templateId: z.string(), rationale: z.string() })) });

export async function rankOpportunities(ctx: TemplateContext, assessment: Assessment, pain: string): Promise<Opportunity[]> {
  const painLower = pain.toLowerCase();
  const scored: Opportunity[] = TEMPLATES.map((t) => {
    const matched = assessment.frictionSignals.filter((s) => s.id.split("+").some((id) => t.signalIds.includes(id)));
    const keywordHit = t.keywords.some((k) => painLower.includes(k)) ? 1 : 0;
    const evidenceCount = matched.reduce((n, s) => n + s.evidence.length, 0);
    const impact = Math.min(1, t.impactBase * (1 + 0.35 * matched.length + 0.3 * keywordHit));
    const evidenceStrength = Math.min(1, matched.length * 0.45 + evidenceCount * 0.1 + keywordHit * 0.3);
    const data = t.dataAvailability(ctx);
    const score = 0.4 * impact + 0.3 * evidenceStrength + 0.2 * data.score + 0.1 * (1 - t.adoptionEffort);
    const because = matched.length
      ? `Addresses: ${matched.map((s) => s.task.toLowerCase()).join("; ")}.`
      : "No specific friction signal found for this; ranked on general fit.";
    return {
      templateId: t.id,
      score: round(score),
      impact: round(impact),
      evidenceStrength: round(evidenceStrength),
      dataAvailability: round(data.score),
      adoptionEffort: t.adoptionEffort,
      rationale: `${because} Data: ${data.reason}. ${t.ownerBenefit}`,
      signalsAddressed: matched.map((s) => s.id.split("+").find((id) => t.signalIds.includes(id)) ?? s.id),
    };
  }).sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 3);
  if (isDemo()) return top;
  try {
    const written = await structured({
      schema: RationaleSchema,
      effort: "low",
      system: "Write a two-sentence 'why this' for each recommended tool, addressed to the business owner, in plain words. Use only the signals and data notes given. Do not add claims.",
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
