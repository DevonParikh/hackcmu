# Tailor — plan and implementation notes

*"Tailor" because it fits a small AI to one specific company. Sections 1–4 are the original
plan; section 5 onward describes what is actually built. When they disagree, the code and
README.md win.*

## 1. The pitch

Paste a company's website URL. Tailor reads the company (site, product, public
code, reviews, job posts), finds its competitors, works out what the company
does well and where it leaks time or customers, and then builds **one small,
targeted AI tool** the company can drop in today: a support widget trained on
their own docs, a lead-intake bot, a review responder, and so on. The output
is a live hosted tool plus a one-line embed snippet, written for an owner who
is not technical.

The bet: most small companies do not need "an AI strategy". They need one
narrow thing that removes a daily chore, and they need someone to pick it for
them and hand it over ready to use.

## 2. What the user experiences (three screens)

**Screen 1 — Start.** One field: website URL. Optional: company name, GitHub
org, a sentence about what hurts most. Press *Analyze*. A live log streams
progress in plain language ("Reading pricing page", "Found 4 competitors",
"Reading 120 Google reviews").

**Screen 2 — Report.** Scannable, owner-language, every claim linked to a
source.
- Company card: what they sell, to whom, how they charge, size, tech stack, tone.
- Competitor grid: 3–5 competitors with the same card, plus a feature matrix.
- *Doing well* / *Not doing well*: short bullets with evidence chips
  (a review quote, a missing page, a job post, a slow response time).
- Friction signals: things that cost the company time (support by email only,
  manual booking, no FAQ, hiring for repetitive roles, unanswered reviews).

**Screen 3 — Recommendation and build.** One recommended tool, two
alternatives, each with *why this*, expected effort saved, confidence, and
what data it needs. The user can rename it, pick a tone, set off-limits
topics, then press *Build*. Tailor generates the tool, runs a self-test
(ten realistic questions drawn from the reviews and FAQ), and shows a live
preview beside the results. Press *Deploy*: hosted link, embed snippet,
and a half-page "how to use this" for the owner.

Design rules: no jargon, no settings the owner would not understand,
confidence shown honestly, every statement about the company traceable
to a source.

## 3. Pipeline

```
URL ─► A. Ingest ─► B. Profile ─► C. Competitors ─► D. Assess ─► E. Rank ─► F. Build ─► G. Deploy
```

### A. Ingest (deterministic + server tools)
- Crawl the company site: home, product, pricing, about, contact, careers,
  FAQ/support, docs, blog (cap ~40 pages, ~200k tokens). Store page text,
  title, links, and the raw CSS for brand colors and logo.
- Tech stack heuristics from headers, script tags, meta (Shopify, Wix,
  WordPress, Stripe, Intercom, Calendly, etc.).
- Public GitHub org if given: README, languages, commit cadence, open issues.
- Web search for reviews and listings (Google, Yelp, G2, Capterra, App Store,
  Trustpilot) and fetch the top results.
- Job postings from the careers page (they reveal repetitive work).
- Fallback when crawling is blocked: let the user paste text or upload a PDF.

### B. Company profile (one structured-output call)
Fields: offering, customer segments, business model, pricing, size estimate,
channels, tech stack, tone of voice, brand tokens, sources[]. Every field
carries source indices so the report can cite.

### C. Competitors (parallel workers)
Web search "alternatives to X", "X vs", category + location. Pick 3–5 with a
short justification. Run a lighter Ingest + Profile on each (fewer pages,
cheaper model). Produce a feature matrix over a shared feature list derived
from the category.

### D. Assessment (structured output, evidence required)
- strengths[] and weaknesses[], each with evidence[] (quote + source URL).
- friction_signals[]: task, who does it, frequency estimate, evidence.
- Comparison against competitors on the feature matrix.
Rule: no claim without a source. Claims without evidence are dropped.

### E. Rank opportunities
Candidates come only from the **template catalog** (section 4), so
everything recommended is deployable. Score each template on:
impact (time saved × frequency), evidence strength, data availability
(do we have enough docs/FAQ/reviews to power it), and owner effort to adopt.
Return top 3 with rationale.

### F. Build the tool
Fill the chosen template:
- system prompt (company facts, tone, scope, escalation rules, off-limits),
- knowledge base (chunked pages, FAQ, policies; embedded in the prompt with
  prompt caching, no vector DB for v1),
- few-shot examples generated from the company's own content,
- brand tokens (colors, logo, name),
- eval set: ten realistic user messages drawn from reviews and FAQ, run
  automatically; failures shown in the UI and used to tighten the prompt once.

### G. Deploy
- Hosted at `/t/{slug}` in the same app with its own config row.
- `<script src=".../embed.js" data-tool="slug">` chat bubble, or a full-page link.
- Optional export: single-file Node server zip with a Deploy-to-Vercel button.
- Owner guide: what it does, what it will not do, how to update facts,
  how to turn it off.

## 4. Template catalog (v1: six)

| Template | Surface | Input → Output | Data needed |
|---|---|---|---|
| Support & FAQ assistant | Site widget | Question → answer with source, escalates to email/phone | Site pages, FAQ, policies |
| Lead / intake bot | Widget or link | Chat → structured lead (name, need, budget, timing) emailed to owner | Services, pricing, service area |
| Review responder | Web page | Paste a review → on-brand reply draft | Reviews, tone, policies |
| Booking intake | Widget | Chat → collected details + hand-off to Calendly/phone | Services, hours, location |
| Listing / description writer | Web page | Product facts → listing copy in brand voice | Product pages, existing copy |
| Staff knowledge assistant | Private link | Staff question → answer from SOPs and site | Uploaded SOPs, site |

Each template is a folder: `prompt.md`, `schema.ts` (config + structured
outputs), `ui.tsx`, `eval.ts`. Adding a template later is adding a folder.

## 5. Architecture (as built)

- **App**: Next.js 16 (App Router) + TypeScript + Tailwind v4. One repo. Owner-facing pages live in `src/app/(site)`; hosted tools at `src/app/t/[slug]` use the bare root layout so the embed iframe has no app chrome.
- **LLM**: Anthropic TypeScript SDK, wrapped in `src/lib/llm.ts`.
  - `claude-opus-5` (adaptive thinking) for profile, assessment, ranking prose, test questions, and grading.
  - `claude-sonnet-5` for competitor research with the server tools `web_search_20260209` / `web_fetch_20260209` (pause_turn handled), and at runtime inside deployed tools with prompt caching over the knowledge block.
  - Structured outputs via `messages.create` + `output_config.format` (`zodOutputFormat`), parsed and validated with zod; `stop_reason` checked for `refusal` and `max_tokens`.
  - Demo mode (no `ANTHROPIC_API_KEY`): the same pipeline with deterministic heuristics and sentence-level BM25 retrieval (`src/lib/runtime/chat.ts`). `scripts/mock-anthropic.mjs` stands in for the API to exercise live paths without a key.
- **Jobs**: `POST /api/analyze` creates the run and schedules `executeRun` with `next/server` `after()`; the report page polls `GET /api/runs/[id]` every 1.5 s. Writes to one run document are serialized per process (`withRunLock`). Runs older than 10 minutes without progress are marked stopped.
- **DB**: MongoDB (official driver), collections `companies`, `runs`, `sources`, `tools`, `conversations`. String `_id`s. Company documents are upserted by host.
- **Ingest**: `src/lib/ingest/crawl.ts` (redirect-aware crawl with a concurrency pool and time budget, charset decoding, private-address guard, structural feature detection, brand/logo/contact detection) and `src/lib/ingest/documents.ts` (PDF via unpdf, text, HTML).
- **Impact model**: `src/lib/pipeline/impact.ts` is the only place numbers are computed. Inputs: crawl, uploads, owner intake (`run.intake`), self-test outcomes, logged conversations. Outputs: topic coverage, self-serve comparison, load and could-move ranges with printed arithmetic, wait bands, self-test outcomes with a Wilson interval, reasons per recommendation, "what we could not check".
- **Templates**: `src/lib/templates/index.ts`, six templates in one file (prompt builder, data-availability rule, company-specific sample questions, greeting).
- **Deployed tool runtime**: `/t/[slug]` page and `POST /api/tools/[slug]/chat`; `GET /embed.js?tool=slug` is self-locating (origin from its own script tag) and carries the brand colour. Per-visitor and per-tool rate limits. Staff-only uploads and job postings never reach customer-facing tools. Each reply stores an `answered` / `handed_off` outcome for the usage panel.
- **Access**: optional `TAILOR_ACCESS_KEY` gates owner pages and APIs; hosted tools stay public.

## 6. Hackathon schedule (24 hours, team of 3–4)

| Hours | Work |
|---|---|
| 0–2 | Repo scaffold, DB schema, template catalog stubs, one shared zod schema file. |
| 2–6 | Ingest + Profile end to end for one real company. Streaming progress log. |
| 6–10 | Competitors + Assessment with evidence. Report screen. |
| 10–14 | Ranking + Build for the Support & FAQ template. Self-test eval. Live preview. |
| 14–17 | Deploy path: `/t/[slug]`, embed snippet, owner guide. |
| 17–20 | Second and third templates (Lead intake, Review responder). Polish report UI. |
| 20–22 | Run on 3 demo companies, fix what breaks, pre-cache their runs for the demo. |
| 22–24 | Demo script, slides, sleep if any. |

Split: one person on ingest/crawl, one on LLM stages and schemas, one on
UI, one floating on deploy and templates.

## 7. Demo script (3 minutes)

1. Paste a local business URL (a bakery or a dental clinic works well). Watch the log.
2. Report: point at one weakness with its review quote, and at the competitor that does it better.
3. Recommendation: "Support & FAQ assistant, because 31 reviews mention slow email replies and the FAQ page has 4 questions."
4. Build, show self-test passing 9/10, fix the failing one by editing an off-limits topic.
5. Deploy. Open the embed on a mock of their site. Ask it a real question. Show the owner guide.

## 8. Risks and mitigations

- **Crawl blocked or thin site** → server web_fetch fallback, then paste/upload. Show "we had little to go on" honestly.
- **Invented competitors or facts** → structured outputs require source indices; drop claims with none; show links in the UI.
- **Latency** → stream every stage, cap pages, run competitors in parallel, pre-run demo companies.
- **Cost** → cache the corpus, cheaper models for workers and runtime, hard cap on pages and tokens per run.
- **Deployed tool says the wrong thing** → scope-locked system prompt, off-limits list, always offers a human contact, eval set before deploy, logs visible to the owner.
- **Too generic a recommendation** → ranking must cite the friction signal it addresses; if no signal scores above a threshold, say so instead of forcing a tool.

## 9. Stretch

Slack and email as deploy surfaces; weekly re-analysis with a "what changed" digest;
measure deflection (questions answered vs escalated) and show the owner a number;
more templates (quote generator, inventory Q&A, appointment reminders);
multi-language tools when the site is bilingual.

## 10. Decisions already made

- TypeScript everywhere; one Next.js app, not separate services.
- Templates over free-form generation: reliability beats novelty for deploy.
- Evidence or it does not ship: every claim in the report links to a source; in live mode quotes are verified against the page text and the model cannot mark its own evidence as an observation.
- No vector database in v1; prompt caching over the crawled corpus is enough at this size.
- Every number wears a badge (seen on your site / from your file / compared / your number / tested / estimate / measured). Nothing is estimated until the owner types a number; estimates are ranges with the arithmetic printed; hand-offs count as zero time saved; no benchmarks, no dollars without an hourly value, nothing annualized.

## 11. Working on this repo

- `npm run typecheck`, `npm run build`, then `npm start` (or `npm run dev`). Needs `MONGODB_URI`; set `TAILOR_ALLOW_PRIVATE_URLS=1` to analyze local fixture sites.
- `npm run smoke` (with `BASE`, `SITE`, `RIVAL`) is the end-to-end test; keep it green. It expects a bakery-like fixture site.
- Prefer deterministic code for anything shown as a number; the LLM writes prose and classifies, it never produces figures.
- Keep copy in plain owner language: no "slug", "template", "score", "deflection".
