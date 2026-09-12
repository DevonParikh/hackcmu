import { isDemo } from "./llm";
import { getTemplate } from "./templates";
import type { ToolDoc } from "./types";

/** What the public tool page and embed are allowed to see. Never the prompt or knowledge. */
export function publicTool(tool: ToolDoc) {
  const t = getTemplate(tool.templateId);
  return {
    slug: tool._id,
    name: tool.config.name,
    mode: tool.mode,
    templateName: t?.name ?? tool.templateId,
    greeting: tool.config.greeting,
    placeholder: tool.config.placeholder,
    formLabel: t?.formLabel ?? "Input",
    brand: tool.config.brand,
    escalation: tool.config.escalation,
    evalSummary: tool.evalSummary,
    suggestedQuestions: tool.config.suggestedQuestions ?? [],
    runId: tool.runId,
    demo: isDemo(),
  };
}
export type PublicTool = ReturnType<typeof publicTool>;
