import type { SourceDoc } from "../types";

/** Numbered corpus for prompts. Sources keep their index so the model can cite them. */
export function buildCorpus(srcs: SourceDoc[], maxChars = 150_000): string {
  const out: string[] = [];
  let used = 0;
  const header = (s: SourceDoc, i: number) => `[${i}] ${s.title}\nURL: ${s.url}\nKIND: ${s.kind}\n${s.description ? "DESCRIPTION: " + s.description + "\n" : ""}`;
  const overhead = srcs.reduce((n, s, i) => n + header(s, i).length + 6, 0);
  const perSource = Math.max(600, Math.floor((maxChars - overhead) / Math.max(srcs.length, 1)));
  srcs.forEach((s, i) => {
    const h = header(s, i);
    const room = maxChars - used - h.length - 6;
    if (room < 200) return;
    const body = s.text.slice(0, Math.min(perSource, room));
    const block = `${h}${body}\n`;
    used += block.length + 6;
    out.push(block);
  });
  return out.join("\n---\n");
}

export function stripTitle(title: string): string {
  return title.split(/\s[|–—-]\s|\s\|\s/)[0].trim();
}
