# Tailor

Paste a company's website. Tailor reads the site, compares it with competitors, shows what is working and what is not with evidence, ranks six deployable AI tool templates, then builds, self-tests, and hosts the best fit with a one-line embed.

Built for HackCMU. Plan and rationale: [docs/TAILOR.md](docs/TAILOR.md).

## What it does

1. **Read** – crawls up to 25 pages of the site (prioritizing pricing, about, FAQ, contact, services, careers), follows redirects, detects tools in use, brand colours, logo, contact channels, and a 12-item checklist of what the site offers customers. Competitor URLs are crawled the same way. Documents the owner uploads (PDF, text, Markdown, CSV, HTML) and notes are read too.
2. **Profile** – what they sell, to whom, how they charge, prices, team size, channels, tone, each stated only when the site supports it.
3. **Compare** – with a Claude API key, finds 3–5 competitors via web search; without one, compares the competitor URLs you enter. Shows a feature matrix and a "ways customers can help themselves" dot plot.
4. **Assess** – strengths, weaknesses, and friction signals (repetitive chores). Every claim carries evidence and a link; in live mode quotes are verified against the page text and dropped when they are not there.
5. **Recommend** – ranks six templates (support & FAQ, lead intake, review responder, booking intake, listing writer, staff assistant). Cards show reasons and what is written down, never a score.
6. **Build and test** – assembles the tool from the site content and uploads, runs a 10-question self-test (the owner's own most-asked questions first), and shows each outcome: answered, handed to a person, or failed.
7. **Show the impact** – a topic-coverage grid, before/after route diagrams, hours-per-week ranges with the arithmetic printed, customer wait bars, and a self-serve comparison. Every number wears a badge saying where it came from (seen on your site, from your file, compared, your number, tested, estimate, measured). Nothing is estimated until the owner enters a number.
8. **Deploy** – hosts the tool at `/t/{slug}` with a one-line embed, platform-specific instructions, an owner's guide, and a live usage panel (answered vs handed off) once people use it.

Everything is stored in MongoDB: `companies`, `runs`, `sources`, `tools`, `conversations`.

## Run it

Requirements: Node 22+, a MongoDB server (local `mongod`, Docker, or Atlas).

```bash
npm install
cp .env.example .env.local     # set MONGODB_URI and, optionally, ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Production:

```bash
npm run build && npm start
```

### Modes

- **Live** (`ANTHROPIC_API_KEY` set): Claude Opus 5 profiles, assesses, and ranks; Claude Sonnet 5 runs competitor research with Anthropic's server-side web search and web fetch tools, and powers the deployed tools with prompt caching over the site content.
- **Demo** (no key, or `TAILOR_DEMO=1`): crawling, feature comparison, friction detection, ranking, MongoDB storage, and the hosted tools all run for real; analysis text and tool replies come from deterministic heuristics and keyword retrieval over the crawled pages. Competitor discovery needs live mode; in demo mode, enter competitor URLs on the start page.

### Environment

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Connection string. Default `mongodb://127.0.0.1:27017/tailor`. |
| `ANTHROPIC_API_KEY` | Enables live mode. |
| `TAILOR_MODEL_MAIN` / `TAILOR_MODEL_WORKER` / `TAILOR_MODEL_RUNTIME` | Model overrides (defaults: `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-5`). |
| `TAILOR_DEMO` | `1` forces demo mode. |
| `TAILOR_ACCESS_KEY` | Optional. When set, the owner's pages and APIs (start page, reports, builds) require this key; hosted tools and their chat stay public. |
| `TAILOR_ALLOW_PRIVATE_URLS` | `1` allows analyzing sites on localhost or private networks (local development only). |
| `NEXT_PUBLIC_BASE_URL` | Optional public origin for embed snippets. The embed script also derives it from its own `<script src>`. |

## Verify

`scripts/smoke.mjs` runs the whole flow against a running server: analyze a site, compare a competitor, build two tools, chat with them, fetch the embed script, render every page, and check that MongoDB holds the company, sources, run, tools, and conversation.

```bash
npm run build && npm start &
BASE=http://127.0.0.1:3000 SITE=https://your-test-site.example RIVAL=https://rival.example npm run smoke
```

The checks assume the fixture bakery site used during development (hours, cake policy, contact details); point `SITE` at a copy of it or adapt the assertions for another site. For local fixtures on `127.0.0.1`, set `TAILOR_ALLOW_PRIVATE_URLS=1`.

To exercise the live-mode code paths without an API key, `scripts/mock-anthropic.mjs` stands in for the Messages API and answers structured-output, tool, and text requests with schema-valid placeholders (it proves the plumbing, not the quality):

```bash
node scripts/mock-anthropic.mjs &
ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:3999 MONGODB_URI=mongodb://127.0.0.1:27017/tailor_mock npm start
```

## Honesty rules the report follows

- No statistic that does not come from the crawl, an uploaded file, the owner's inputs, the self-test, or logged conversations. No industry benchmarks.
- Every estimate is a range with the arithmetic printed beside it; "k of 10" before any percentage.
- A handed-off question counts as zero time saved and is framed as a good outcome for the customer.
- Dollar figures appear only when the owner enters an hourly value; nothing is annualized.
- Staff-only uploads never reach customer-facing tools; job postings never reach them either.
- The "what we could not check" section is always shown.

## Layout

```
src/app                 pages and API routes (App Router)
  api/analyze           POST  start a run
  api/runs/[id]         GET   run + company + built tools
  api/runs/[id]/build   POST  build and self-test a template
  api/tools/[slug]      GET   public tool config (no prompt or knowledge)
  api/tools/[slug]/chat POST  chat or form completion
  embed.js              GET   drop-in widget script
  runs/[id]             report page
  t/[slug]              hosted tool page (?embed=1 for the widget)
src/lib/ingest          crawler, tech/brand/contact/feature detection
src/lib/pipeline        profile, competitors, assess, signals, rank, build, run, impact (all report arithmetic)
src/components/charts   inline SVG charts (topic grid, route diagrams, outcome strip, range and wait bars, dot plot)
src/lib/templates       the six tool templates (prompt, self-test questions, data needs)
src/lib/runtime         deployed-tool answering (Claude or keyword retrieval)
src/lib/llm.ts          Anthropic SDK wrapper: structured outputs, text, web research
src/lib/db.ts           MongoDB client and collections
```

## Deploy

Works on Vercel or any Node host. Set `MONGODB_URI` (Atlas works well) and `ANTHROPIC_API_KEY`. Analysis runs after the response via `after()`, so give the platform a function timeout of a few minutes for `/api/analyze` and `/api/runs/[id]/build`.
