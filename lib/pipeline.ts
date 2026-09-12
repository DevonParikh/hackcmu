// lib/pipeline.ts — Stages A–E, arranged for speed.
//
//   A  scrape (5 pages at a time)  ─┐
//   A2 review search (starts as soon as the home page is read)  ─┴─► B+D one call: profile + assessment
//   D2 verify (deterministic) → judge (one small call) → E rank (one small call) → report is viewable
//   C  benchmark runs after that, and fills in on refresh
//
// Every stage's result is saved to Mongo as it lands, so a refresh resumes.

import { ObjectId } from "mongodb";
import { z } from "zod";
import { db } from "./db";
import { scrapeSite } from "./scrape";
import { generateJSON, generateText, lastProvider } from "./llm";
import { Profile, Benchmark, Assessment, Ranking, TEMPLATES, type Source } from "./schemas";
import { dedupeBoilerplate, verifyAssessment, judgeRelevance, applyVerdicts } from "./verify";
import { extractFeatures } from "./features";
import { estimate, type Estimate } from "./estimator";

export type Log = (msg: string) => void;

/** What the owner added on the start page beyond the URL. All optional. */
export type AnalysisInput = {
  name?: string;              // business name, overrides the title guess
  pain?: string;              // "what takes up the most time right now"
  documents?: Source[];       // uploaded files and typed notes, kind "pasted"
  competitors?: string[];     // competitor site URLs to crawl for the benchmark
};
const oneLine = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/\s+/g, " ").slice(0, 80);

// Number the sources so the model can cite by index. Small per-page cap: latency scales with input.
function corpus(sources: Source[], perPage = 3500, max = 32_000): string {
  let out = "";
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const cap = s.kind === "review" ? 5000 : perPage;
    const block = `[${i}] ${s.title || s.kind} — ${s.url}\n${s.text.slice(0, cap)}\n\n`;
    if (out.length + block.length > max) break;
    out += block;
  }
  return out;
}

async function findReviews(name: string, url: string): Promise<Source | null> {
  const { text, cites } = await generateText(
    `Find customer reviews and listings for "${name}" (${url}). Summarise what customers praise and what they complain about, ` +
    `with short direct quotes and where each quote came from. If you can see how quickly the business replies to reviews, say so. ` +
    `If customers mention phoning or emailing for things that could be self-service (hours, bookings, refunds, menu questions), quote them. Under 400 words.`,
    { grounding: true },
  );
  return text.trim() ? { url: cites[0] ?? "search", title: "Reviews and listings (search)", kind: "review", text } : null;
}

const ProfileAndAssessment = z.object({ profile: Profile, assessment: Assessment });

export async function runAnalysis(runId: ObjectId, url: string, log: Log, onReady?: () => void, onEstimate?: (e: Estimate) => void, input: AnalysisInput = {}) {
  const t0 = Date.now();
  const documents = input.documents ?? [];
  const competitorUrls = input.competitors ?? [];
  const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const timings: Record<string, number> = {};
  const mark = (k: string) => { timings[k] = Math.round((Date.now() - t0) / 100) / 10; };

  const runs = (await db()).collection("runs");
  const save = (patch: Record<string, unknown>) =>
    runs.updateOne({ _id: runId }, { $set: { ...patch, updatedAt: new Date() } });

  // ---- A + A2: crawl, with the review search running alongside it
  log(`Opening ${url}`);
  let reviews: Promise<Source | null> = Promise.resolve(null);
  let name = input.name?.trim() || new URL(url).hostname;
  // Competitor sites the owner named are read alongside the main crawl; the benchmark uses them at the end.
  const competitorCrawls = Promise.all(competitorUrls.map(async cu => {
    try {
      const r = await scrapeSite(cu, () => {}, { maxPages: 6 });
      log(`Read ${r.sources.length} page${r.sources.length === 1 ? "" : "s"} from competitor ${new URL(cu).hostname}`);
      return { url: cu, ...r };
    } catch { log(`Couldn't read competitor ${new URL(cu).hostname}`); return { url: cu, sources: [] as Source[], colors: [], logo: null, thin: false }; }
  }));
  const scraped = await scrapeSite(url, log, {
    onHome: title => {
      if (!input.name?.trim()) name = title.split(/[|–—-]/)[0].trim() || name;
      reviews = findReviews(name, url).catch(e => { log(`No reviews found (${oneLine(e)}), continuing`); return null; });
    },
  });
  if (!scraped.sources.length) throw new Error("Couldn't read anything from that site. Try another URL, or paste some text.");
  if (scraped.thin) log("This site draws most of its content with JavaScript, so there's less to read than usual");
  const { sources, removed } = dedupeBoilerplate(scraped.sources);
  const { colors, logo, thin } = scraped;
  mark("scrape");
  log(`Read ${sources.length} page${sources.length === 1 ? "" : "s"} in ${since()}${removed ? `, skipped ${removed} repeated menu and footer lines` : ""}`);

  const rev = await reviews;
  if (rev) { sources.push(rev); log("Found reviews"); }
  if (documents.length) { sources.push(...documents); log(`Added ${documents.length} document${documents.length === 1 ? "" : "s"} from you: ${documents.map(d => d.title).join(", ")}`); }
  mark("reviews");

  // ---- instant estimate from structure alone (only if scripts/train-estimator.py has produced data/estimator.json)
  const features = extractFeatures(sources, thin);
  const quickEstimate = estimate(features);
  if (quickEstimate) {
    const t = quickEstimate.template, h = quickEstimate.hours;
    log(`Quick read of the site's structure: ${t ? `likely needs ${t.name} (${Math.round(t.prob * 100)}%)` : ""}${t && h ? ", " : ""}${h ? `about ${h.value} hours a week` : ""}. Reading the details…`);
    onEstimate?.(quickEstimate);
  }
  await save({ stage: "scraped", name, sources, brand: { colors, logo }, thin, features, quickEstimate, timings, input: { name: input.name ?? "", pain: input.pain ?? "", competitors: competitorUrls, documents: documents.map(d => d.title) } });

  // ---- B + D: one call. Profile and assessment together; the corpus is sent once.
  log("Reading it all and working out where the week goes");
  const { profile, assessment } = await generateJSON(ProfileAndAssessment,
`You are assessing a small, nontechnical company for repetitive work that one narrow AI tool could take over.
Return two things: a short profile of the company, and an assessment.

Template ids you may put in a friction signal's "template" (or null): ${TEMPLATES.map(t => `${t.id} = ${t.name}`).join("; ")}.

Profile: owner language, no jargon. Cite source indices in "sources".${input.name?.trim() ? ` The business is called "${input.name.trim()}".` : ""}
${input.pain?.trim() ? `
The owner says the biggest time sink right now is: "${input.pain.trim().replace(/"/g, "'")}". Look for evidence of this first and include a friction signal for it when the sources support it; if nothing in the sources shows it, still include it with confidence "low" and evidence from the closest page.
` : ""}${documents.length ? `
Sources titled "upload:…" or "Notes from the owner" were supplied by the owner (menus, price lists, policies, notes). They count as the business's own material: a question answered there is answerable.
` : ""}
Assessment rules:
- Every strength, weakness and friction signal needs at least one piece of evidence: a short direct quote and the source index it came from. Quote exactly; do not paraphrase.
- frictionSignals: 3 to 6 things a person does by hand, repeatedly: answering the same questions by phone or email, chasing bookings, refund disputes, replying to reviews, writing listings.
- Evidence must show the task HAPPENING (a review saying "I had to call", a page saying "email us to book"), not merely that the topic exists. An hours table is not evidence that people call about hours. If the only evidence is the topic existing, keep the signal but set confidence to low.
- hoursPerWeek is an ESTIMATE, derived from the evidence, conservative. Most small businesses lose 3 to 12 hours a week to all of this combined; a single task is usually 1 to 4. Only go higher with strong evidence. confidence is "low" unless two or more sources agree.
- label is the same task in 3 to 5 words for a chart axis ("Hours & delivery calls").
- coverage.questions: 10 to 25 questions customers actually ask, taken from reviews, FAQ, and contact pages. answerable=true only if the site's own pages answer it.
- Write task text the owner would recognise ("answering 'are you open Sunday' by phone"), not analyst language.

${corpus(sources)}`);
  mark("assess");
  log(`Read by ${lastProvider()} in ${since()}`);
  name = profile.name || name;
  await save({ stage: "assessed", name, profile, assessment, timings });

  // ---- D2: verify quotes against the sources, then judge whether each shows the task or only suggests it
  log(`Checking every quote against the sources`);
  const verified = verifyAssessment(assessment, sources);
  let final = verified.assessment;
  const report = verified.report;
  let judgePairs: { claim: string; quote: string; verdict: string }[] = [];
  try {
    const pairs = final.frictionSignals.flatMap(f => f.evidence.map(e => ({ claim: f.task, quote: e.quote })));
    const verdicts = await judgeRelevance(pairs);
    log(`Evidence judged by ${process.env.JUDGE_URL ? "our fine-tuned judge" : lastProvider()}`);
    judgePairs = pairs.map((p, i) => ({ ...p, verdict: verdicts[i] }));   // labeled pairs: training data for a local judge
    const judged = applyVerdicts(final.frictionSignals, verdicts, report);
    if (judged.length) final = { ...final, frictionSignals: judged };
    else log("None of the evidence showed the tasks happening; keeping them as low-confidence suggestions");
  } catch { log("Couldn't double-check evidence relevance; keeping it as is"); }
  if (!final.frictionSignals.length) throw new Error("Nothing repetitive was found with evidence to back it. Try a site with reviews or an FAQ.");
  mark("verify");
  await save({ assessment: final, verification: report, judgePairs, timings });
  log(`Checked ${report.checked} quotes: ${report.dropped} weren't in the sources, ${report.unrelated} didn't support their claim`);

  // ---- E: rank (small input, fast)
  log("Picking the one tool worth building");
  const answerable = final.coverage.questions.filter(q => q.answerable).length;
  const ranking = await generateJSON(Ranking,
`Rank AI tools for this company. Candidates (id, name, deflection = share of that task the tool typically absorbs):
${TEMPLATES.map(t => `- ${t.id}: ${t.name}, deflection ${t.deflection}`).join("\n")}

Friction signals: ${JSON.stringify(final.frictionSignals.map(f => ({ task: f.task, hoursPerWeek: f.hoursPerWeek, confidence: f.confidence, template: f.template })))}
Coverage: ${answerable} of ${final.coverage.questions.length} customer questions are answerable from the site today.

Return the top 3. For each: "addresses" is the friction signal's task text copied exactly; hoursNow is that signal's hoursPerWeek;
hoursAfter = hoursNow × (1 − deflection), rounded to one decimal; "assumption" states that arithmetic in plain words
("if it handles 60% of these questions"); confidence copies the signal's confidence. Prefer templates whose data is actually
present (a support assistant needs answerable questions). belowThreshold = true if the best hoursNow is under 1.`);
  mark("rank");
  await save({ stage: "ranked", ranking, finishedAt: new Date(), timings });
  log(`Done in ${since()}`);
  onReady?.();

  // ---- C: benchmark, off the critical path. The report is already open; this fills in on refresh.
  // Competitors the owner named are compared from their own pages, deterministically; otherwise the model searches.
  let benchmark: Benchmark | null = null;
  const rivals = (await competitorCrawls).filter(r => r.sources.length);
  if (rivals.length) {
    const you = extractFeatures(sources, thin);
    benchmark = {
      you: { hasFaq: !!you.hasFaq, hasOnlineBooking: !!you.hasOnlineBooking, reviewReplyDays: null },
      competitors: rivals.slice(0, 4).map(r => {
        const f = extractFeatures(r.sources, r.thin);
        const title = r.sources[0]?.title?.split(/[|–—-]/)[0].trim();
        return { name: title || new URL(r.url).hostname, url: r.url, note: "Named by the owner", hasFaq: !!f.hasFaq, hasOnlineBooking: !!f.hasOnlineBooking, reviewReplyDays: null };
      }),
    };
    mark("benchmark");
    await save({ benchmark, timings });
    log(`Compared with ${rivals.length} competitor${rivals.length === 1 ? "" : "s"} from their own pages`);
  } else try {
    const { text } = await generateText(
      `Name up to 3 direct competitors of "${profile.name}" (${profile.offering}; customers: ${profile.customers.join(", ")}). ` +
      `For each: name, website, whether they have an FAQ page, whether they offer online booking, and typical days to reply to reviews if visible. ` +
      `Then answer the same three questions for "${profile.name}" itself. Brief and factual; say "unknown" when you don't know.`,
      { grounding: true },
    );
    benchmark = await generateJSON(Benchmark, `Convert these notes to the schema. Use null for anything unknown.\n\n${text}`);
    mark("benchmark");
    await save({ benchmark, timings });
  } catch { /* cuttable */ }

  return { name, profile, benchmark, assessment: final, ranking };
}
