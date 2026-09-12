import type { SourceDoc } from "../types";

/** Numbered corpus for prompts. Sources keep their index so the model can cite them. */
export function buildCorpus(srcs: SourceDoc[], maxChars = 150_000): string {
  const out: string[] = [];
  let used = 0;
  srcs.forEach((s, i) => {
    const budget = Math.max(1500, Math.floor(maxChars / Math.max(srcs.length, 1)));
    const body = s.text.slice(0, budget);
    const block = `[${i}] ${s.title}\nURL: ${s.url}\nKIND: ${s.kind}\n${s.description ? "DESCRIPTION: " + s.description + "\n" : ""}${body}\n`;
    if (used + block.length > maxChars) return;
    used += block.length;
    out.push(block);
  });
  return out.join("\n---\n");
}

export function stripTitle(title: string): string {
  return title.split(/\s[|–—-]\s|\s\|\s/)[0].trim();
}
