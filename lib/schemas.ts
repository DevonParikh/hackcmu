// lib/schemas.ts — the contract between the LLM stages and the screens.
// If a chart needs a number, it is a field here, and the stage that produces it validates against it.

import { z } from "zod";

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

// One crawled page, one review summary, one pasted blob. Index into this array = citation.
export const Source = z.object({
  url: z.string(),
  title: z.string().default(""),
  kind: z.enum(["page", "review", "listing", "search", "pasted"]).default("page"),
  text: z.string(),
});
export type Source = z.infer<typeof Source>;

export const Evidence = z.object({
  quote: z.string().describe("short direct quote from the source"),
  source: z.number().int().nonnegative().describe("index into sources[]"),
});
export type Evidence = z.infer<typeof Evidence>;

// ---------------------------------------------------------------- B. Profile
export const Profile = z.object({
  name: z.string(),
  offering: z.string().describe("what they sell, one sentence"),
  customers: z.array(z.string()).describe("who buys it"),
  businessModel: z.string(),
  pricing: z.string(),
  sizeEstimate: z.string(),
  channels: z.array(z.string()).describe("how customers reach them: email, phone, walk-in, Instagram…"),
  techStack: z.array(z.string()),
  tone: z.string().describe("how they write, three words"),
  sources: z.array(z.number().int().nonnegative()),
});
export type Profile = z.infer<typeof Profile>;

// ---------------------------------------------------------------- C. Benchmark (light)
const Signals = z.object({
  reviewReplyDays: z.number().nullable().describe("typical days to reply to a review, null if unknown"),
  hasFaq: z.boolean().nullable(),
  hasOnlineBooking: z.boolean().nullable(),
});
export const Competitor = Signals.extend({
  name: z.string(),
  url: z.string().nullable(),
  note: z.string().describe("one line on why they compete"),
});
export const Benchmark = z.object({
  you: Signals,
  competitors: z.array(Competitor).max(4),
});
export type Benchmark = z.infer<typeof Benchmark>;

// ---------------------------------------------------------------- template catalog
// Candidates for E come only from here, so every recommendation is buildable.
export const TEMPLATES = [
  { id: "support-faq",     name: "Support & FAQ assistant",       money: true,  deflection: 0.6 },
  { id: "lead-intake",     name: "Lead / intake bot",             money: false, deflection: 0.5 },
  { id: "review-responder",name: "Review responder",              money: false, deflection: 0.7 },
  { id: "booking-intake",  name: "Booking intake",                money: true,  deflection: 0.5 },
  { id: "listing-writer",  name: "Listing / description writer",  money: false, deflection: 0.8 },
  { id: "staff-knowledge", name: "Staff knowledge assistant",     money: false, deflection: 0.5 },
] as const;
export const TemplateId = z.enum(["support-faq", "lead-intake", "review-responder", "booking-intake", "listing-writer", "staff-knowledge"]);
export type TemplateId = z.infer<typeof TemplateId>;
export const templateById = (id: string) => TEMPLATES.find(t => t.id === id);

// ---------------------------------------------------------------- D. Assessment
// Feeds C1 (frictionSignals) and C2 (coverage).
export const FrictionSignal = z.object({
  task: z.string().describe("a repetitive thing a person does by hand, in the owner's words"),
  who: z.string().describe("who does it: owner, front desk, whoever answers email"),
  hoursPerWeek: z.number().min(0).max(80).describe("ESTIMATE, derived from evidence, conservative"),
  confidence: Confidence,
  evidence: z.array(Evidence).min(1),
  template: TemplateId.nullable().describe("catalog id that could take this over, or null"),
});
export type FrictionSignal = z.infer<typeof FrictionSignal>;

export const Question = z.object({
  text: z.string(),
  answerable: z.boolean().describe("true only if the site's own pages answer it"),
  source: z.number().int().nonnegative(),
});

export const Assessment = z.object({
  strengths:  z.array(z.object({ text: z.string(), evidence: z.array(Evidence).min(1) })),
  weaknesses: z.array(z.object({ text: z.string(), evidence: z.array(Evidence).min(1) })),
  frictionSignals: z.array(FrictionSignal).min(1).max(8),
  coverage: z.object({ questions: z.array(Question).min(1).max(30) }),
});
export type Assessment = z.infer<typeof Assessment>;

// ---------------------------------------------------------------- E. Ranking
// Feeds C4 (before/after) and Screen 3.
export const Opportunity = z.object({
  template: TemplateId,
  why: z.string().describe("two sentences, owner language"),
  addresses: z.string().describe("the friction signal's task text, copied exactly"),
  hoursNow: z.number().min(0),
  hoursAfter: z.number().min(0),
  assumption: z.string().describe("the arithmetic in plain words: 'if it handles 60% of these questions'"),
  confidence: Confidence,
  dataNeeded: z.array(z.string()),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const Ranking = z.object({
  top: z.array(Opportunity).min(1).max(3),
  belowThreshold: z.boolean().describe("true if nothing is worth building; say so instead of forcing a tool"),
});
export type Ranking = z.infer<typeof Ranking>;

// ---------------------------------------------------------------- the run document (Mongo `runs`)
export type Run = {
  _id?: unknown;
  url: string;
  name?: string;
  stage: "started" | "scraped" | "profiled" | "assessed" | "ranked" | "failed";
  error?: string;
  sources?: Source[];
  brand?: { colors: string[]; logo: string | null };
  profile?: Profile;
  benchmark?: Benchmark | null;
  assessment?: Assessment;
  ranking?: Ranking;
  createdAt: Date;
  updatedAt?: Date;
  finishedAt?: Date;
};
