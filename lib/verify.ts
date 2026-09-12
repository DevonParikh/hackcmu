// lib/verify.ts — makes "evidence or it doesn't ship" a mechanism instead of an instruction.
//
//   dedupeBoilerplate(sources)      nav/footer lines that repeat across pages are kept once
//   verifyAssessment(a, sources)    every quote must be found in its source (or somewhere); confidence is earned; hours are capped
//   judgeRelevance(pairs)           one Gemini call: does the quote SHOW the task happening, or only SUGGEST it?

import { z } from "zod";
import { generateJSON } from "./llm";
import type { Assessment, Evidence, Source, Confidence, VerifyReport, FrictionSignal } from "./schemas";

export const normalize = (s: string) =>
  s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
   .replace(/[^\p{L}\p{N}\s$%.:'-]/gu, " ").replace(/\s+/g, " ").trim();

// 1 if the (normalized) quote is a substring of the text; otherwise the share of its 3-word shingles found.
export function quoteScore(quote: string, text: string): number {
  const q = normalize(quote), t = normalize(text);
  if (!q || !t) return 0;
  if (t.includes(q)) return 1;
  const w = q.split(" ");
  if (w.length < 4) return 0;
  let hit = 0, n = 0;
  for (let i = 0; i + 3 <= w.length; i++) { n++; if (t.includes(w.slice(i, i + 3).join(" "))) hit++; }
  return n ? hit / n : 0;
}

const THRESHOLD = 0.6;

export const emptyReport = (): VerifyReport =>
  ({ checked: 0, kept: 0, reindexed: 0, dropped: 0, itemsDropped: 0, downgraded: 0, clamped: 0, judged: 0, unrelated: 0 });

// Keep a quote if it is in its cited source; else in any source (fix the index); else drop it.
export function verifyEvidence(list: Evidence[], sources: Source[], rep: VerifyReport): Evidence[] {
  const out: Evidence[] = [];
  for (const e of list) {
    rep.checked++;
    const cited = sources[e.source];
    if (cited && quoteScore(e.quote, cited.text) >= THRESHOLD) { out.push(e); rep.kept++; continue; }
    let best = -1, bestScore = 0;
    sources.forEach((s, i) => { const sc = quoteScore(e.quote, s.text); if (sc > bestScore) { bestScore = sc; best = i; } });
    if (best >= 0 && bestScore >= THRESHOLD) { out.push({ ...e, source: best }); rep.kept++; rep.reindexed++; continue; }
    rep.dropped++;
  }
  return out;
}

// Confidence is earned from evidence, never self-reported.
// Demonstrating evidence from 2+ sources → high; from 1 → medium; only suggestions (or unjudged, 3+ sources) → low.
export function earnedConfidence(ev: Evidence[]): Confidence {
  const demo = new Set(ev.filter(e => e.kind === "demonstrates").map(e => e.source)).size;
  if (demo >= 2) return "high";
  if (demo === 1) return "medium";
  const judged = ev.some(e => e.kind);
  if (judged) return "low";
  const distinct = new Set(ev.map(e => e.source)).size;     // no judge ran: distinct sources stand in
  return distinct >= 3 ? "medium" : "low";
}

const ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const CAP: Record<Confidence, number> = { low: 10, medium: 20, high: 40 };

export function applyConfidence(signals: FrictionSignal[], rep: VerifyReport): FrictionSignal[] {
  let out = signals.map(f => {
    const earned = earnedConfidence(f.evidence);
    const confidence = ORDER[earned] < ORDER[f.confidence] ? (rep.downgraded++, earned) : earned;
    let hoursPerWeek = f.hoursPerWeek;
    if (hoursPerWeek > CAP[confidence]) { hoursPerWeek = CAP[confidence]; rep.clamped++; }
    return { ...f, confidence, hoursPerWeek };
  });
  const total = out.reduce((s, f) => s + f.hoursPerWeek, 0);   // nobody has 60 hours of chores
  if (total > 40) { const k = 40 / total; out = out.map(f => ({ ...f, hoursPerWeek: Math.round(f.hoursPerWeek * k * 2) / 2 })); rep.clamped++; }
  return out;
}

export function verifyAssessment(a: Assessment, sources: Source[]): { assessment: Assessment; report: VerifyReport } {
  const rep = emptyReport();
  const keepIf = <T extends { evidence: Evidence[] }>(items: T[]) => items
    .map(it => ({ ...it, evidence: verifyEvidence(it.evidence, sources, rep) }))
    .filter(it => { if (it.evidence.length) return true; rep.itemsDropped++; return false; });
  const strengths      = keepIf(a.strengths);
  const weaknesses     = keepIf(a.weaknesses);
  const frictionSignals = applyConfidence(keepIf(a.frictionSignals), rep);
  const questions      = a.coverage.questions.filter(q => sources[q.source]);
  return { assessment: { strengths, weaknesses, frictionSignals, coverage: { questions } }, report: rep };
}

// Nav and footer lines repeat on every page. Keep the first copy (hours and phone numbers survive once), drop the rest.
export function dedupeBoilerplate(sources: Source[]): { sources: Source[]; removed: number } {
  const count = new Map<string, number>();
  for (const s of sources) if (s.kind === "page")
    for (const l of new Set(s.text.split("\n").map(normalize).filter(l => l.length >= 12))) count.set(l, (count.get(l) ?? 0) + 1);
  const seen = new Set<string>();
  let removed = 0;
  const out = sources.map(s => {
    if (s.kind !== "page") return s;
    const lines = s.text.split("\n").filter(raw => {
      const l = normalize(raw);
      if (l.length < 12 || (count.get(l) ?? 0) < 3) return true;
      if (seen.has(l)) { removed++; return false; }
      seen.add(l); return true;
    });
    return { ...s, text: lines.join("\n") };
  });
  return { sources: out, removed };
}

// One call. For each (claim, quote): does the quote show the task actually happening?
const Verdicts = z.object({ verdicts: z.array(z.enum(["demonstrates", "suggests", "unrelated"])) });
export type Verdict = z.infer<typeof Verdicts>["verdicts"][number];

export async function judgeRelevance(pairs: { claim: string; quote: string }[]): Promise<Verdict[]> {
  if (!pairs.length) return [];
  // A local distilled judge (scripts/judge.py serve) answers in ~40ms. Gemini is the fallback.
  if (process.env.JUDGE_URL) {
    try {
      const r = await fetch(process.env.JUDGE_URL, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairs }), signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const { verdicts } = await r.json();
        const ok = Array.isArray(verdicts) && verdicts.length === pairs.length && verdicts.every(v => ["demonstrates", "suggests", "unrelated"].includes(v));
        if (ok) return verdicts as Verdict[];
      }
    } catch { /* fall through to Gemini */ }
  }
  const res = await generateJSON(Verdicts,
`You are checking evidence for claims about a small business. For each numbered pair, classify the QUOTE:
- "demonstrates": the quote shows the CLAIM actually happening — a customer or reviewer describing doing it, a page saying "call us to…", a staff note about doing it by hand.
- "suggests": the quote is related and makes the claim plausible, but does not show it happening — an hours table, a menu item, a policy line.
- "unrelated": the quote has nothing to do with the claim.
A menu item does not demonstrate that customers phone about the menu. Return exactly ${pairs.length} verdicts, in order.

${pairs.map((p, i) => `${i + 1}. CLAIM: ${p.claim}\n   QUOTE: ${p.quote}`).join("\n")}`, { prefer: "ifm" });
  return pairs.map((_, i) => res.verdicts[i] ?? "suggests");
}

// Apply verdicts to friction signals. Drops unrelated quotes and signals left with none; recomputes confidence.
export function applyVerdicts(signals: FrictionSignal[], verdicts: Verdict[], rep: VerifyReport): FrictionSignal[] {
  let k = 0;
  const tagged = signals.map(f => ({
    ...f,
    evidence: f.evidence
      .map((e): Evidence | null => { const v = verdicts[k++]; rep.judged++; if (v === "unrelated") { rep.unrelated++; return null; } return { ...e, kind: v }; })
      .filter((e): e is Evidence => e !== null),
  })).filter(f => { if (f.evidence.length) return true; rep.itemsDropped++; return false; });
  return applyConfidence(tagged, rep);
}
