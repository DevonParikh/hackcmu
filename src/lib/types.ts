import { z } from "zod";

// ---------- Shared value schemas (used for structured outputs and DB docs) ----------

export const EvidenceSchema = z.object({
  quote: z.string().describe("Short verbatim quote or concrete observation"),
  sourceUrl: z.string().describe("URL the evidence came from"),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ContactSchema = z.object({
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const CompanyProfileSchema = z.object({
  name: z.string(),
  tagline: z.string().describe("One sentence: what they sell and to whom"),
  offering: z.string().describe("2-3 sentences on products or services"),
  customerSegments: z.array(z.string()),
  businessModel: z.string().describe("How they make money"),
  pricingSummary: z.string().describe("What pricing is public, or 'not published'"),
  sizeEstimate: z.string().describe("e.g. 'solo', '2-10 staff', '50-200 staff', with the reason"),
  channels: z.array(z.string()).describe("How customers reach them: walk-in, phone, web form, app"),
  toneOfVoice: z.string(),
  location: z.string().nullable(),
  sourceIndices: z.array(z.number().int()).describe("Indices of the sources used"),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

export const FEATURE_KEYS = [
  "onlineBooking",
  "liveChat",
  "faqPage",
  "pricingPage",
  "contactForm",
  "reviewsShown",
  "blog",
  "socialLinks",
  "emailCapture",
  "ecommerce",
  "careersPage",
  "mobileReady",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  onlineBooking: "Online booking",
  liveChat: "Live chat",
  faqPage: "FAQ page",
  pricingPage: "Pricing page",
  contactForm: "Contact form",
  reviewsShown: "Reviews on site",
  blog: "Blog or news",
  socialLinks: "Social links",
  emailCapture: "Email signup",
  ecommerce: "Online ordering or checkout",
  careersPage: "Careers page",
  mobileReady: "Mobile viewport",
};
export const FeatureChecklistSchema = z.record(z.enum(FEATURE_KEYS), z.boolean());
export type FeatureChecklist = Record<FeatureKey, boolean>;

export const CompetitorSchema = z.object({
  name: z.string(),
  url: z.string(),
  why: z.string().describe("Why this is a competitor"),
  offering: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
});
export type Competitor = z.infer<typeof CompetitorSchema> & {
  features?: FeatureChecklist;
  tech?: string[];
};

export const ClaimSchema = z.object({
  claim: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const FrictionSignalSchema = z.object({
  id: z.string().describe("snake_case identifier, e.g. support_by_email_only"),
  task: z.string().describe("The repetitive chore"),
  who: z.string().describe("Who does it today"),
  frequency: z.string().describe("Estimated frequency, e.g. 'several times a day'"),
  evidence: z.array(EvidenceSchema).min(1),
});
export type FrictionSignal = z.infer<typeof FrictionSignalSchema>;

export const AssessmentSchema = z.object({
  strengths: z.array(ClaimSchema),
  weaknesses: z.array(ClaimSchema),
  frictionSignals: z.array(FrictionSignalSchema),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const OpportunitySchema = z.object({
  templateId: z.string(),
  score: z.number(),
  impact: z.number(),
  evidenceStrength: z.number(),
  dataAvailability: z.number(),
  adoptionEffort: z.number().describe("Lower is easier"),
  rationale: z.string(),
  signalsAddressed: z.array(z.string()),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const KnowledgeChunkSchema = z.object({
  title: z.string(),
  url: z.string(),
  text: z.string(),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

export const BrandSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  logoUrl: z.string().nullable(),
});
export type Brand = z.infer<typeof BrandSchema>;

export const ToolConfigSchema = z.object({
  name: z.string(),
  tone: z.string(),
  offLimits: z.array(z.string()),
  escalation: ContactSchema,
  brand: BrandSchema,
  systemPrompt: z.string(),
  knowledge: z.array(KnowledgeChunkSchema),
  placeholder: z.string(),
  greeting: z.string(),
});
export type ToolConfig = z.infer<typeof ToolConfigSchema>;

export const EvalCaseSchema = z.object({
  question: z.string(),
  answer: z.string(),
  pass: z.boolean(),
  note: z.string(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

// ---------- Run input ----------

export const AnalyzeInputSchema = z.object({
  url: z.string().min(4),
  name: z.string().optional().default(""),
  competitors: z.array(z.string()).optional().default([]),
  github: z.string().optional().default(""),
  pain: z.string().optional().default(""),
});
export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

export const BuildInputSchema = z.object({
  templateId: z.string(),
  name: z.string().optional().default(""),
  tone: z.string().optional().default(""),
  offLimits: z.array(z.string()).optional().default([]),
});
export type BuildInput = z.infer<typeof BuildInputSchema>;

// ---------- Mongo documents ----------

export type LogEntry = { t: string; msg: string; level: "info" | "warn" | "error" };

export type RunStage =
  | "queued"
  | "ingest"
  | "profile"
  | "competitors"
  | "assess"
  | "rank"
  | "done"
  | "failed";

export interface CompanyDoc {
  _id: string;
  host: string;
  url: string;
  name: string;
  profile: CompanyProfile | null;
  features: FeatureChecklist | null;
  tech: string[];
  brand: Brand;
  contact: Contact;
  pageCount: number;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunDoc {
  _id: string;
  companyId: string;
  url: string;
  input: AnalyzeInput;
  mode: "live" | "demo";
  status: "queued" | "running" | "done" | "failed";
  stage: RunStage;
  log: LogEntry[];
  competitors: Competitor[];
  assessment: Assessment | null;
  opportunities: Opportunity[];
  toolIds: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceDoc {
  _id: string;
  runId: string;
  companyId: string;
  url: string;
  kind: "page" | "review" | "job" | "repo" | "user" | "search";
  title: string;
  text: string;
  description: string;
  fetchedAt: string;
}

export interface ToolDoc {
  _id: string; // slug
  companyId: string;
  runId: string;
  templateId: string;
  mode: "chat" | "form";
  config: ToolConfig;
  evals: EvalCase[];
  evalSummary: { passed: number; total: number };
  createdAt: string;
}

export interface ConversationDoc {
  _id: string;
  toolId: string;
  messages: { role: "user" | "assistant"; content: string; t: string }[];
  createdAt: string;
  updatedAt: string;
}
