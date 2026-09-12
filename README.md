# Tailor

Paste a company's website. Tailor reads the site, compares it with competitors, shows what is working and what is not with evidence, ranks six deployable AI tool templates, then builds, self-tests, and hosts the best fit with a one-line embed.

Built for HackCMU. Plan and rationale: [CLAUDE.md](CLAUDE.md).

## What it does

1. **Ingest** – crawls up to 25 pages of the site (prioritizing pricing, about, FAQ, contact, services, careers), detects tech stack, brand colors, logo, contact channels, and a 12-item site feature checklist. Competitor URLs you provide are crawled the same way.
2. **Profile** – what they sell, to whom, business model, pricing, size, channels, tone.
3. **Competitors** – with a Claude API key, finds 3–5 competitors via web search and compares them; without one, compares the competitor URLs you enter.
4. **Assess** – strengths, weaknesses, and friction signals (repetitive chores). Every claim carries a quote and a source URL; claims without evidence are dropped.
5. **Rank** – scores six templates (support & FAQ, lead intake, review responder, booking intake, listing writer, staff assistant) on impact, evidence, data availability, and adoption effort.
6. **Build** – assembles the tool from the site content, runs a 10-question self-test, and shows the results.
7. **Deploy** – hosts the tool at `/t/{slug}` with an embed snippet and an owner guide.

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
| `NEXT_PUBLIC_BASE_URL` | Public origin used in embed snippets (defaults to the request origin). |

## Verify

`scripts/smoke.mjs` runs the whole flow against a running server: analyze a site, compare a competitor, build two tools, chat with them, fetch the embed script, render every page, and check that MongoDB holds the company, sources, run, tools, and conversation.

```bash
npm run build && npm start &
BASE=http://127.0.0.1:3000 SITE=https://your-test-site.example RIVAL=https://rival.example npm run smoke
```

The checks assume the fixture bakery site used during development (hours, cake policy, contact details); point `SITE` at a copy of it or adapt the assertions for another site.

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
src/lib/pipeline        profile, competitors, assess, signals, rank, build, run
src/lib/templates       the six tool templates (prompt, self-test questions, data needs)
src/lib/runtime         deployed-tool answering (Claude or keyword retrieval)
src/lib/llm.ts          Anthropic SDK wrapper: structured outputs, text, web research
src/lib/db.ts           MongoDB client and collections
```

## Deploy

Works on Vercel or any Node host. Set `MONGODB_URI` (Atlas works well) and `ANTHROPIC_API_KEY`. Analysis runs after the response via `after()`, so give the platform a function timeout of a few minutes for `/api/analyze` and `/api/runs/[id]/build`.
