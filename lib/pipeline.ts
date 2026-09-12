// lib/pipeline.ts — Stages A–E. One function, one log callback, results saved to Mongo as they land.

import { ObjectId } from "mongodb";
import { db } from "./db";
import { scrapeSite } from "./scrape";
import { generateJSON, generateText } from "./gemini";
import { Profile, Benchmark, Assessment, Ranking, TEMPLATES, type Source } from "./schemas";

export type Log = (msg: string) => void;

// Number the sources so the model can cite by index. Cap the total so we stay inside the context.
function corpus(sources: Source[], maxChars = 90_000): string {
  let out = "";
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const block = `[${i}] ${s.title || s.kind} — ${s.url}\n${s.text}\n\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out;
}

export async function runAnalysis(runId: ObjectId, url: string, log: Log) {
  const runs = (await db()).collection("runs");
  const save = (patch: Record<string, unknown>) =>
    runs.updateOne({ _id: runId }, { $set: { ...patch, updatedAt: new Date() } });

  // ---- A. Scrape
  log(`Opening ${url}`);
  const { sources, colors, logo } = await scrapeSite(url, log);
  if (!sources.length) throw new Error("Couldn't read anything from that site. Try another URL, or paste some text.");
  log(`Read ${sources.length} page${sources.length === 1 ? "" : "s"}`);
  const name = (sources[0].title.split(/[|–—-]/)[0].trim() || new URL(url).hostname);

  // ---- A2. Reviews and listings, via search grounding
  log("Looking for reviews");
  try {
    const { text, cites } = await generateText(
      `Find customer reviews and listings for "${name}" (${url}). Summarise what customers praise and what they complain about, ` +
      `with short direct quotes and where each quote came from. If you can see how quickly the business replies to reviews, say so. ` +
      `If the business emails or phones customers for things that could be self-service (bookings, refunds, FAQs), note it. Under 400 words.`,
      { grounding: true },
    );
    if (text.trim()) {
      sources.push({ url: cites[0] ?? "search", title: "Reviews and listings (search)", kind: "review", text });
      log(cites.length ? `Found reviews across ${cites.length} sources` : "Found some reviews");
    }
  } catch { log("No reviews found, continuing"); }
  await save({ stage: "scraped", name, sources, brand: { colors, logo } });

  // ---- B. Profile
  log("Working out what the company does");
  const profile = await generateJSON(Profile,
    `Profile this company from its pages. Owner language, no jargon. Cite source indices in "sources".\n\n${corpus(sources)}`);
  await save({ stage: "profiled", profile });

  // ---- C. Benchmark (light, cuttable)
  let benchmark: Benchmark | null = null;
  try {
    log("Looking at nearby competitors");
    const { text } = await generateText(
      `Name up to 3 direct competitors of "${profile.name}" (${profile.offering}; customers: ${profile.customers.join(", ")}). ` +
      `For each: name, website, whether they have an FAQ page, whether they offer online booking, and typical days to reply to reviews if visible. ` +
      `Then answer the same three questions for "${profile.name}" itself. Brief and factual; say "unknown" when you don't know.`,
      { grounding: true },
    );
    benchmark = await generateJSON(Benchmark, `Convert these notes to the schema. Use null for anything unknown.\n\n${text}`);
    await save({ benchmark });
    log(`Compared against ${benchmark.competitors.length} competitor${benchmark.competitors.length === 1 ? "" : "s"}`);
  } catch { log("Skipped competitors"); }

  // ---- D. Assess  (feeds C1 and C2)
  log("Finding where the week goes");
  const assessment = await generateJSON(Assessment,
`You are assessing a small, nontechnical company for repetitive work that one narrow AI tool could take over.

Template ids you may put in "template" (or null): ${TEMPLATES.map(t => `${t.id} = ${t.name}`).join("; ")}.

Rules:
- Every strength, weakness and friction signal needs at least one piece of evidence: a short quote and the source index it came from.
- frictionSignals: 3 to 6 things a person does by hand, repeatedly: answering the same questions by email, chasing bookings, refund disputes, replying to reviews, writing listings.
- hoursPerWeek is an ESTIMATE. Derive it from the evidence and show your reasoning inside the quote's context; be conservative. confidence is "low" unless two or more sources agree.
- coverage.questions: 10 to 25 questions customers actually ask, taken from reviews, FAQ, and contact pages. answerable=true only if the site's own pages answer it.
- Write task text the owner would recognise ("answering 'are you open Sunday' by email"), not analyst language.

${corpus(sources)}`);
  await save({ stage: "assessed", assessment });
  log(`Found ${assessment.frictionSignals.length} things that eat time`);

  // ---- E. Rank  (feeds C4 and Screen 3)
  log("Picking the one tool worth building");
  const answerable = assessment.coverage.questions.filter(q => q.answerable).length;
  const ranking = await generateJSON(Ranking,
`Rank AI tools for this company. Candidates (id, name, deflection = share of that task the tool typically absorbs):
${TEMPLATES.map(t => `- ${t.id}: ${t.name}, deflection ${t.deflection}`).join("\n")}

Friction signals: ${JSON.stringify(assessment.frictionSignals.map(f => ({ task: f.task, hoursPerWeek: f.hoursPerWeek, confidence: f.confidence, template: f.template })))}
Coverage: ${answerable} of ${assessment.coverage.questions.length} customer questions are answerable from the site today.

Return the top 3. For each: "addresses" is the friction signal's task text copied exactly; hoursNow is that signal's hoursPerWeek;
hoursAfter = hoursNow × (1 − deflection), rounded to one decimal; "assumption" states that arithmetic in plain words
("if it handles 60% of these questions"); confidence copies the signal's confidence. Prefer templates whose data is actually
present (a support assistant needs answerable questions). belowThreshold = true if the best hoursNow is under 1.`);
  await save({ stage: "ranked", ranking, finishedAt: new Date() });
  log("Done");

  return { name, profile, benchmark, assessment, ranking };
}
