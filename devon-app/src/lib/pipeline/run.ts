import { companies, now, runs, sources } from "../db";
import { crawlSite } from "../ingest/crawl";
import { isDemo } from "../llm";
import type { TemplateContext } from "../templates";
import type { CompanySnapshot, LogEntry, RunDoc, RunStage, SourceDoc } from "../types";
import { assessCompany } from "./assess";
import { findCompetitors } from "./competitors";
import { profileCompany } from "./profile";
import { rankOpportunities } from "./rank";
import { detectSignals } from "./signals";

// Updates to one run document are serialized per process so fire-and-forget log
// appends never interleave with stage writes (MongoDB itself is atomic per document,
// but keeping writes ordered also keeps the log readable).
const locks = new Map<string, Promise<unknown>>();
function withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(runId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => undefined);
  locks.set(runId, settled);
  settled.then(() => {
    if (locks.get(runId) === settled) locks.delete(runId);
  });
  return next;
}

export function appendLog(runId: string, msg: string, level: LogEntry["level"] = "info"): Promise<void> {
  const entry: LogEntry = { t: now(), msg, level };
  return withRunLock(runId, async () => {
    const col = await runs();
    try {
      await col.updateOne({ _id: runId }, { $push: { log: entry }, $set: { updatedAt: entry.t } });
    } catch {
      const doc = await col.findOne({ _id: runId });
      await col.updateOne({ _id: runId }, { $set: { log: [...(doc?.log ?? []), entry], updatedAt: entry.t } });
    }
  });
}

function updateRun(runId: string, fields: Partial<RunDoc>): Promise<void> {
  return withRunLock(runId, async () => {
    await (await runs()).updateOne({ _id: runId }, { $set: { ...fields, updatedAt: now() } });
  });
}

export function pushToolId(runId: string, toolId: string): Promise<void> {
  return withRunLock(runId, async () => {
    const col = await runs();
    try {
      await col.updateOne({ _id: runId }, { $push: { toolIds: toolId }, $set: { updatedAt: now() } });
    } catch {
      const doc = await col.findOne({ _id: runId });
      await col.updateOne({ _id: runId }, { $set: { toolIds: [...(doc?.toolIds ?? []), toolId], updatedAt: now() } });
    }
  });
}

function setStage(runId: string, stage: RunStage, extra: Partial<RunDoc> = {}): Promise<void> {
  return updateRun(runId, { stage, ...extra });
}

/** Runs the whole analysis for a run document. Safe to call in the background. */
export async function executeRun(runId: string): Promise<void> {
  const runCol = await runs();
  const run = await runCol.findOne({ _id: runId });
  if (!run) return;
  const log = (msg: string) => void appendLog(runId, msg).catch((e) => console.error("log write failed", e));
  try {
    await setStage(runId, "ingest", { status: "running" });
    log(isDemo() ? "Demo mode: no Claude API key set, using deterministic analysis" : "Live mode: using Claude for analysis");
    log(`Reading ${run.url}`);
    // The raw input decides whether an http fallback is allowed (the owner typed no scheme).
    const crawl = await crawlSite(run.input.url || run.url, { maxPages: 25, log: (m) => log(m) });
    if (!crawl.pages.length) throw new Error("Could not read any pages from that URL. Check the address or paste content instead.");
    log(`Read ${crawl.pages.length} pages${crawl.skipped ? ` (${crawl.skipped} skipped)` : ""}. Tools detected: ${crawl.tech.join(", ") || "none"}`);
    if (crawl.externalHosts.length) log(`The site links out to: ${crawl.externalHosts.slice(0, 5).join(", ")}`);

    const srcCol = await sources();
    await srcCol.deleteMany({ runId, kind: { $ne: "user" } });
    const userDocs = await srcCol.find({ runId, kind: "user" }).toArray();
    if (userDocs.length) log(`Read ${userDocs.length} document(s) you provided: ${userDocs.map((d) => d.title).join(", ")}`);
    const srcDocs: SourceDoc[] = crawl.pages.map((p) => ({
      _id: crypto.randomUUID(),
      runId,
      companyId: run.companyId,
      url: p.url,
      kind: /career|jobs|hiring/i.test(p.url) ? "job" : "page",
      title: p.title,
      text: p.text,
      description: p.description,
      fetchedAt: now(),
    }));
    if (srcDocs.length) await srcCol.insertMany(srcDocs);
    const allSources: SourceDoc[] = [...srcDocs, ...userDocs];

    await setStage(runId, "profile");
    log("Profiling the company");
    const profile = await profileCompany({ crawl, sources: allSources, nameHint: run.input.name });
    const compCol = await companies();
    await compCol.updateOne(
      { _id: run.companyId },
      {
        $set: {
          name: profile.name,
          profile,
          features: crawl.features,
          tech: crawl.tech,
          brand: crawl.brand,
          contact: crawl.contact,
          pageCount: crawl.pages.length,
          lastRunId: runId,
          updatedAt: now(),
        },
      },
    );
    const snapshot: CompanySnapshot = { name: profile.name, url: crawl.rootUrl, profile, features: crawl.features, tech: crawl.tech, brand: crawl.brand, contact: crawl.contact, pageCount: crawl.pages.length };
    await updateRun(runId, { snapshot });
    log(`Profiled ${profile.name}: ${profile.tagline}`);

    await setStage(runId, "competitors");
    const competitors = await findCompetitors({ companyName: profile.name, url: crawl.rootUrl, profile, providedUrls: run.input.competitors, log });
    log(competitors.length ? `Compared against ${competitors.length} competitor(s): ${competitors.map((c) => c.name).join(", ")}` : "No competitors compared");
    await updateRun(runId, { competitors });

    await setStage(runId, "assess");
    log("Assessing strengths, weaknesses, and friction");
    const signals = detectSignals(crawl, run.input.pain);
    const assessment = await assessCompany({ companyName: profile.name, crawl, sources: allSources, competitors, signals, log });
    await updateRun(runId, { assessment });
    log(`Found ${assessment.strengths.length} strengths, ${assessment.weaknesses.length} weaknesses, ${assessment.frictionSignals.length} friction signals`);

    await setStage(runId, "rank");
    const ctx: TemplateContext = {
      companyName: profile.name,
      url: crawl.rootUrl,
      profile,
      features: crawl.features,
      contact: crawl.contact,
      signals: assessment.frictionSignals,
      pageTitles: allSources.map((p) => p.title),
      pageCount: allSources.length,
      text: allSources.map((p) => p.text).join("\n").toLowerCase().slice(0, 200_000),
      tone: profile.toneOfVoice,
      offLimits: [],
    };
    const opportunities = await rankOpportunities(ctx, assessment, run.input.pain);
    await updateRun(runId, { opportunities });
    log(`Recommended: ${opportunities[0]?.templateId ?? "nothing"}`);
    await setStage(runId, "done", { status: "done" });
    log("Analysis complete");
  } catch (e) {
    const msg = (e as Error).message || String(e);
    await appendLog(runId, msg, "error");
    await setStage(runId, "failed", { status: "failed", error: msg });
  }
}
