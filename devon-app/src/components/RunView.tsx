"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BADGE_MEANINGS, Badge, type BadgeKind, OutcomeStrip, RangeBar, RouteDiagram, Scrollable, SelfServeDots, TopicGrid, WaitBars } from "@/components/charts";
import { IntakePanel } from "@/components/IntakePanel";
import { UsagePanel } from "@/components/UsagePanel";
import { BUCKETS, BUCKET_LABELS } from "@/lib/buckets";
import type { Impact } from "@/lib/pipeline/impact";
import { TEMPLATES } from "@/lib/templates";
import { FEATURE_KEYS, FEATURE_LABELS, type CompanyDoc, type Competitor, type Evidence, type EvalCase, type RunDoc } from "@/lib/types";

type BuiltTool = {
  _id: string;
  templateId: string;
  mode: "chat" | "form";
  config: { name: string; tone: string; offLimits: string[]; greeting: string; brand: { primary: string }; suggestedQuestions: string[] };
  evals: EvalCase[];
  evalSummary: { passed: number; total: number };
  knowledgeCount: number;
  createdAt: string;
};
type SourceMeta = { id: string; title: string; url: string; kind: string; audience: string | null; chars: number };
type Payload = { run: RunDoc; company: CompanyDoc | null; impact: Impact | null; sources: SourceMeta[]; tools: BuiltTool[] };

const STAGES: { key: RunDoc["stage"]; label: string }[] = [
  { key: "ingest", label: "Reading the site" },
  { key: "profile", label: "Profiling" },
  { key: "competitors", label: "Competitors" },
  { key: "assess", label: "Assessing" },
  { key: "rank", label: "Recommending" },
  { key: "done", label: "Done" },
];

const LEGEND: BadgeKind[] = ["site", "file", "compared", "you", "said", "tested", "estimate", "measured"];

/** Where each evidence link points, so a chip can say whose page it is. */
type PageContext = { companyHost: string; competitors: Pick<Competitor, "name" | "url">[]; sources: SourceMeta[] };

function hostOf(u: string): string {
  try {
    return new URL(u).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pathWords(u: string): string {
  try {
    const x = new URL(u);
    const path = x.pathname === "/" ? "home" : x.pathname.replace(/^\//, "").replace(/\/$/, "").replace(/\.(html?|php|aspx?)$/, "").replace(/[-_/]+/g, " ");
    return path.length > 28 ? path.slice(0, 27) + "…" : path;
  } catch {
    return "";
  }
}

/** "your contact page", "Crust & Co's page", or the host for anything else. */
function linkLabel(u: string, ctx: PageContext): string {
  const host = hostOf(u);
  if (host && host === ctx.companyHost) return `your ${pathWords(u)} page`;
  const rival = ctx.competitors.find((c) => hostOf(c.url) === host);
  if (rival) return `${rival.name}'s page`;
  const path = pathWords(u);
  return host ? `${host}${path && path !== "home" ? ` ${path}` : ""}` : "source";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** FEATURE_LABELS as they should read mid-sentence: "No FAQ page", "Has online booking". */
function properFeatureCase(text: string): string {
  let out = text;
  for (const label of Object.values(FEATURE_LABELS)) {
    const mid = /^[A-Z]{2,}/.test(label) ? label : label[0].toLowerCase() + label.slice(1);
    if (mid === label.toLowerCase()) continue;
    out = out.replace(new RegExp(`(?<=\\w )${escapeRe(label.toLowerCase())}`, "g"), mid);
  }
  return out;
}

function retryHref(run: RunDoc): string {
  const p = new URLSearchParams();
  p.set("url", run.input?.url ?? run.url);
  if (run.input?.competitors?.length) p.set("competitors", run.input.competitors.join(","));
  if (run.input?.pain) p.set("pain", run.input.pain);
  return `/?${p.toString().replace(/\+/g, "%20")}`;
}

export function RunView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [building, setBuilding] = useState(false);
  const failures = useRef(0);
  const logRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (res.status === 404 || res.status === 401) setGone(true);
      if (!res.ok) throw new Error(json.error || "Could not load the report");
      failures.current = 0;
      setData(json);
      setError(null);
      return json as Payload;
    } catch (e) {
      failures.current += 1;
      setError((e as Error).message);
      return null;
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load();
      if (!alive) return;
      if (gone || failures.current >= 5) return;
      const active = !d || d.run.status === "queued" || d.run.status === "running";
      if (active || building) timer = setTimeout(tick, active ? 1500 : 2500);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [load, gone, building]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data?.run.log.length]);

  if (error && !data)
    return (
      <main className="mx-auto max-w-3xl px-5 py-12">
        <p role="alert" style={{ color: "var(--bad)" }}>
          {error}
        </p>
        <div className="mt-4 flex gap-2">
          {!gone && (
            <button type="button" className="btn" onClick={() => { failures.current = 0; load(); }}>
              Try again
            </button>
          )}
          <Link href="/" className="btn-ghost">
            Back to the start
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="mx-auto max-w-3xl px-5 py-12" style={{ color: "var(--muted)" }}>
        Loading your report…
      </main>
    );

  const { run, company, impact, sources, tools } = data;
  const running = run.status === "queued" || run.status === "running";
  const done = run.status === "done";
  // A run that stopped before profiling has no snapshot; the shared company record may belong to an older run, so it is not shown.
  const failedEarly = run.status === "failed" && !run.snapshot;
  const stageIdx = STAGES.findIndex((s) => s.key === run.stage);
  const primaryTool = tools[0] ?? null;
  const hasFiles = sources.some((s) => s.kind === "user");
  const minutesKey = run.intake?.minutesPerInquiry;
  const minutesRange = minutesKey ? BUCKETS.minutes[minutesKey] : null;
  const waitLabel = impact?.wait.today ? impact.wait.today.label : null;
  const waitAppliesTo = impact?.wait.today?.appliesTo ?? "all";
  const personLabel = "You or your staff";
  const title = failedEarly ? run.input?.name || run.url : (company?.name ?? run.url);
  const pageCtx: PageContext = { companyHost: hostOf(company?.url ?? run.url), competitors: run.competitors, sources };
  const showCompany = !!company?.profile && !failedEarly;

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      {/* 1. Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{run.mode === "demo" ? "Report · demo mode" : "Report"}</p>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <a href={run.url} target="_blank" rel="noreferrer" className="text-sm" style={{ color: "var(--muted)" }}>
            {run.url}
          </a>
        </div>
        {(running || run.status === "failed") && (
          <div className="flex flex-wrap gap-1">
            {STAGES.map((s, i) => (
              <span key={s.key} className={"chip " + (i < stageIdx ? "chip-good" : i === stageIdx && running ? "chip-accent" : "")}>
                {s.label}
              </span>
            ))}
            {run.status === "failed" && <span className="chip chip-bad">Stopped</span>}
          </div>
        )}
      </div>
      {error && data && (
        <p className="mt-3 rounded-lg px-3 py-2 text-sm" role="alert" style={{ background: "#f9e3e3", color: "var(--bad)" }}>
          {error} {failures.current >= 5 ? "Updates paused; reload the page to try again." : ""}
        </p>
      )}
      {impact?.headline && (
        <p className="mt-4 max-w-3xl text-lg font-semibold" style={{ textWrap: "balance" }}>
          {impact.headline}
        </p>
      )}
      {impact && (
        <details className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          <summary>
            Every number wears a badge saying where it came from. <span className="when-closed">Show what each means</span>
            <span className="when-open">Hide the meanings</span>
          </summary>
          <div className="badge-legend mt-2">
            {LEGEND.map((k) => (
              <span key={k}>
                <Badge kind={k} /> {BADGE_MEANINGS[k]}
              </span>
            ))}
          </div>
        </details>
      )}
      {done && impact && company && (
        <nav className="toc mt-4" aria-label="Sections of this report">
          <a href="#routes">Where questions go</a>
          <a href="#written">What is written down</a>
          <a href="#competitors">Competitors</a>
          <a href="#chores">Chores</a>
          <a href="#recommendation">Recommendation</a>
          <a href="#build">Build</a>
          {tools.length > 0 && <a href="#tested">Tested</a>}
          <a href="#expect">What to expect</a>
        </nav>
      )}

      {/* 2. Progress */}
      <details className="panel mt-6 px-4 py-3" open={running}>
        <summary className="flex items-center justify-between text-sm font-semibold">
          <span>{running ? `Working: ${STAGES[stageIdx]?.label ?? "starting"}…` : `Progress log (${run.log.length} steps)`}</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {running ? (
              "updates every few seconds"
            ) : (
              <>
                <span className="when-closed">show</span>
                <span className="when-open">hide</span>
              </>
            )}
          </span>
        </summary>
        <ul ref={logRef} className="mono mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          {run.log.map((l, i) => (
            <li key={i} style={{ color: l.level === "error" ? "var(--bad)" : l.level === "warn" ? "var(--ochre)" : "var(--muted)" }}>
              <span className="opacity-60">{new Date(l.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> {l.msg}
            </li>
          ))}
        </ul>
      </details>

      {run.status === "failed" && (
        <section className="panel mt-6 p-4" style={{ borderColor: "#efc4c4" }}>
          <p className="font-semibold" style={{ color: "var(--bad)" }}>
            The analysis stopped: {run.error}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Things to try: check that the website address is right and opens in your browser; if the site blocks automated reading, paste the text of your main pages into
            the notes box on the start page, or add your documents (a menu, price list, or policies) so we have something to work from.
          </p>
          <Link href={retryHref(run)} className="btn-ghost mt-3">
            Try again with the same details
          </Link>
        </section>
      )}

      {/* 3. Company card and checklist */}
      {showCompany && company?.profile && (
        <section className="mt-8 grid gap-4 md:grid-cols-[1.3fr_1fr]" id="company">
          <div className="panel p-5">
            <p className="eyebrow">Your business, as your site describes it</p>
            <h2 className="mt-1 text-xl font-bold">{company.profile.tagline}</h2>
            <p className="mt-2 text-sm">{company.profile.offering}</p>
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Row k="Customers" v={company.profile.customerSegments.join(", ")} />
              <Row k="How you charge" v={company.profile.businessModel} />
              <Row k="Prices" v={company.profile.pricingSummary} />
              <Row k="Team size" v={company.profile.sizeEstimate} />
              <Row k="Reachable by" v={company.profile.channels.join(", ")} />
              <Row k="Tone of voice" v={company.profile.toneOfVoice} />
              <Row k="Location" v={company.profile.location ?? "not published"} />
              <Row k="Contact" v={[company.contact.email, company.contact.phone].filter(Boolean).join(" · ") || "none found"} />
            </dl>
            {company.profile.sourceUrls && company.profile.sourceUrls.length > 0 && (
              <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                From:{" "}
                {company.profile.sourceUrls.map((u, i) => (
                  <span key={u}>
                    {i > 0 && ", "}
                    <a href={u} target="_blank" rel="noreferrer" className="tap" style={{ color: "var(--accent)" }} aria-label={`${sourceTitle(u, sources)}, opens in a new tab`}>
                      {sourceTitle(u, sources)}
                    </a>
                  </span>
                ))}
              </p>
            )}
            {company.tech.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1">
                {company.tech.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="panel p-5">
            <p className="eyebrow">What your site offers customers</p>
            <ul className="mt-2 grid gap-1 text-sm">
              {FEATURE_KEYS.map((k) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span>{FEATURE_LABELS[k]}</span>
                  <span className={"chip " + (company.features?.[k] ? "chip-good" : "chip-bad")}>{company.features?.[k] ? "yes" : "no"}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
              Brand colours we found
              <span className="inline-block h-4 w-4 rounded" style={{ background: company.brand.primary }} />
              <span className="inline-block h-4 w-4 rounded" style={{ background: company.brand.secondary }} />
            </div>
          </div>
        </section>
      )}

      {impact && company && !failedEarly && (
        <>
          {/* 4. Where questions go today */}
          <Section id="routes" title="Where customer questions go today" lede="Every way a customer can reach you, from your own pages, and where each one ends up.">
            <RouteDiagram channels={impact.channels} after={false} selfTest={null} waitLabel={waitLabel} waitAppliesTo={waitAppliesTo} personLabel={personLabel} selfServe={impact.selfServe.company.features} />
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
              {impact.channels.map((c) => (
                <span key={c.id} className="chip">
                  {c.label}
                  {c.url && (
                    <>
                      {" "}
                      <a href={c.url} target="_blank" rel="noreferrer" className="tap" style={{ color: "var(--accent)" }} aria-label={`${c.label}: ${linkLabel(c.url, pageCtx)}, opens in a new tab`}>
                        {linkLabel(c.url, pageCtx)}
                      </a>
                    </>
                  )}
                </span>
              ))}
              {impact.wait.today?.source === "site" && impact.wait.today.quote && (
                <span>
                  Your site says &ldquo;{impact.wait.today.quote}&rdquo;{waitAppliesTo === "email" ? " about email; we found no promise for phone or walk-in" : ""}{" "}
                  {impact.wait.today.url && (
                    <a href={impact.wait.today.url} target="_blank" rel="noreferrer" className="tap" style={{ color: "var(--accent)" }} aria-label={`${linkLabel(impact.wait.today.url, pageCtx)}, opens in a new tab`}>
                      {linkLabel(impact.wait.today.url, pageCtx)}
                    </a>
                  )}
                </span>
              )}
            </p>
          </Section>

          {/* 5. What is written down + intake */}
          <Section
            id="written"
            title="What is written down where an assistant can read it"
            lede={`${impact.writtenDown.covered} of ${impact.writtenDown.total} common customer topics are covered on your site${hasFiles ? " and files" : ""}. An assistant can only answer what is written down; the rows marked "not found" are the ones to fill. Tap "written down" to open the page we found it on.`}
          >
            <div className="panel px-2 py-1">
              <TopicGrid topics={impact.topics} hasFiles={hasFiles} />
            </div>
            {impact.topics.some((t) => t.nudge) && (
              <ul className="mt-2 grid gap-1 text-sm">
                {impact.topics
                  .filter((t) => t.nudge)
                  .map((t) => (
                    <li key={t.id} style={{ color: "var(--muted)" }}>
                      <b style={{ color: "var(--ink)" }}>{t.label}:</b> {t.nudge}.
                    </li>
                  ))}
              </ul>
            )}
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              &ldquo;Written down&rdquo; means the topic is mentioned on your pages or files, not that the answer is right or current. Open the linked page to confirm before relying on it.
            </p>
            <div className="mt-4">
              <IntakePanel runId={run._id} intake={run.intake ?? { topQuestions: [] }} sources={sources} showItems={run.opportunities.some((o) => o.templateId === "review_responder" || o.templateId === "listing_writer")} onSaved={load} />
            </div>
          </Section>

          {/* 6. Competitors */}
          <Competitors run={run} company={company} impact={impact} afterBuild={!!primaryTool} />

          {/* 7. Doing well / not */}
          {run.assessment && (
            <section className="mt-10 grid gap-4 md:grid-cols-2" id="assessment">
              <ClaimList title="Doing well" claims={run.assessment.strengths} tone="good" ctx={pageCtx} />
              <ClaimList title="Not doing well" claims={run.assessment.weaknesses} tone="bad" ctx={pageCtx} />
            </section>
          )}

          {/* 8. Chores */}
          {run.assessment && (
            <Section id="chores" title="Chores that eat time" lede="Repetitive work we could see from your site and what you told us. Each one links to where we saw it.">
              <ul className="grid gap-3 md:grid-cols-2">
                {run.assessment.frictionSignals.length === 0 && <li style={{ color: "var(--muted)" }}>Nothing specific found. That usually means the site already lets customers help themselves.</li>}
                {run.assessment.frictionSignals.map((s) => (
                  <li key={s.id} className="panel p-3 text-sm">
                    <div className="font-semibold">{s.task}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      Who: {s.who}. How often: {frequencyText(s.frequency)}. <CostTag id={s.id} />
                    </div>
                    <EvidenceList evidence={s.evidence} ctx={pageCtx} />
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                {impact.load ? (
                  <>
                    <p className="text-sm font-semibold">
                      Time on routine questions now <Badge kind="you" />
                    </p>
                    <RangeBar rows={[{ label: "Routine questions, per week", low: impact.load.low, high: impact.load.high }]} unit="h/week" />
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {impact.load.arithmetic}. How we read your answers: {bucketNotes(run)}. Your own guess, multiplied out; nothing here is measured yet.
                    </p>
                  </>
                ) : (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    Tell us roughly how many customer questions reach you in a week (in{" "}
                    <a href="#intake" style={{ color: "var(--accent)" }}>
                      Add what you know
                    </a>
                    ) and this becomes an hour range.
                  </p>
                )}
                {impact.drafting && (
                  <div className="mt-3">
                    <p className="text-sm font-semibold">
                      Time drafting replies or listings now <Badge kind="you" />
                    </p>
                    <RangeBar rows={[{ label: "Drafting, per month", low: impact.drafting.low, high: impact.drafting.high }]} unit="h/month" />
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {impact.drafting.arithmetic}.
                    </p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* 9-12. Recommendation, build, expect, deploy */}
          {done && (
            <Recommendations run={run} impact={impact} tools={tools} onBuilt={load} onBuilding={setBuilding} minutesRange={minutesRange} waitLabel={waitLabel} waitAppliesTo={waitAppliesTo} personLabel={personLabel} companyName={company.name} tech={company.tech} />
          )}

          {/* 13. Not checked */}
          <Section id="not-checked" title="What we could not check" lede="So you can weigh the report fairly.">
            <ul className="grid gap-1 text-sm" style={{ color: "var(--muted)" }}>
              {impact.notChecked.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </main>
  );
}

function Section({ id, title, lede, children }: { id?: string; title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10" id={id}>
      <h2 className="section-title">{title}</h2>
      {lede && <p className="lede mt-1">{lede}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function sourceTitle(u: string, sources: SourceMeta[]): string {
  const path = pathWords(u);
  if (path) return `${path} page`;
  return sources.find((s) => s.url === u)?.title || u;
}

const COSTS: Record<string, { text: string; tip: string }> = {
  wait: { text: "Customers wait for a reply", tip: "Every one of these questions sits in an inbox or voicemail until someone gets to it." },
  selfServe: { text: "Customers can't help themselves", tip: "There is no way for a customer to do this on the site without a person in the loop." },
  reviews: { text: "Reviews sit unanswered elsewhere", tip: "Reviews live on another site, so replying means going there and writing each one by hand." },
  paid: { text: "Paid staff time", tip: "You are hiring or paying someone to do this by hand." },
  yours: { text: "Your own time", tip: "This lands on you, by your own account." },
};

function CostTag({ id }: { id: string }) {
  const key = /support|faq|inquir|lead/.test(id) ? "wait" : /booking|order/.test(id) ? "selfServe" : /review/.test(id) ? "reviews" : /hiring/.test(id) ? "paid" : "yours";
  const c = COSTS[key];
  return (
    <>
      Costs:{" "}
      <span className="chip" title={c.tip}>
        {c.text}
      </span>
    </>
  );
}

function frequencyText(f: string): string {
  const t = f.trim();
  if (!t || /^not stated$/i.test(t)) return "not stated on the site";
  if (/^as described$/i.test(t)) return "as often as you described";
  return t[0].toLowerCase() + t.slice(1);
}

/** The printed reading of the owner's multiple-choice answers, skipping any that would just repeat themselves. */
function bucketNotes(run: RunDoc): string {
  const shareKey = run.intake?.routineShare ?? "unsure";
  const minKey = run.intake?.minutesPerInquiry ?? "unsure";
  const [sLo, sHi] = BUCKETS.share[shareKey];
  const [mLo, mHi] = BUCKETS.minutes[minKey];
  const shareLabel = BUCKET_LABELS.share[shareKey];
  const shareRange = `${Math.round(sLo * 100)}-${Math.round(sHi * 100)}%`;
  const minLabel = BUCKET_LABELS.minutes[minKey];
  const minRange = `${mLo}-${mHi} min`;
  const parts = [shareLabel === shareRange ? shareLabel : `"${shareLabel}" = ${shareRange}`, minLabel === minRange ? minLabel : `"${minLabel}" = ${minRange}`];
  return parts.join("; ");
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs uppercase" style={{ color: "var(--muted)" }}>
        {k}
      </dt>
      <dd>{v}</dd>
    </div>
  );
}

function EvidenceList({ evidence, ctx }: { evidence: Evidence[]; ctx: PageContext }) {
  return (
    <ul className="mt-1 grid gap-0.5">
      {evidence.map((e, i) => {
        const absence = !!e.observed && /pages we read/i.test(e.quote);
        const quote = properFeatureCase(e.quote);
        return (
          <li key={i} className="text-xs" style={{ color: "var(--muted)" }}>
            {e.observed ? quote : `“${quote}”`}
            {e.sourceUrl === "user-input" ? (
              <>
                {" · "}
                <Badge kind="said" />
              </>
            ) : e.sourceUrl.startsWith("user-upload:") ? (
              <>
                {" · "}
                <Badge kind="file" />
              </>
            ) : absence ? null : (
              <>
                {" · "}
                <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="tap" style={{ color: "var(--accent)" }} aria-label={`${linkLabel(e.sourceUrl, ctx)}, opens in a new tab`}>
                  {linkLabel(e.sourceUrl, ctx)}
                </a>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ClaimList({ title, claims, tone, ctx }: { title: string; claims: { claim: string; evidence: Evidence[] }[]; tone: "good" | "bad"; ctx: PageContext }) {
  return (
    <div className="panel p-4">
      <p className="eyebrow" style={{ color: tone === "good" ? "var(--good)" : "var(--bad)" }}>
        {title}
      </p>
      <ul className="mt-2 grid gap-3 text-sm">
        {claims.length === 0 && <li style={{ color: "var(--muted)" }}>Nothing with evidence.</li>}
        {claims.map((c, i) => (
          <li key={i}>
            <div className="font-semibold">{properFeatureCase(c.claim)}</div>
            <EvidenceList evidence={c.evidence} ctx={ctx} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function YesNo({ v }: { v: boolean | null }) {
  return (
    <span className="yn" data-v={v === null ? "unknown" : v ? "yes" : "no"}>
      {v === null ? "Not checked" : v ? "Yes" : "No"}
    </span>
  );
}

function Competitors({ run, company, impact, afterBuild }: { run: RunDoc; company: CompanyDoc; impact: Impact; afterBuild: boolean }) {
  const typed = run.input?.competitors ?? [];
  const compared = run.competitors.filter((c) => !!c.features);
  const unreadable = run.competitors.filter((c) => !c.features);
  const unreadList = (unreadable.length ? unreadable.map((c) => c.url) : typed).join(", ");
  if (compared.length === 0) {
    return (
      <Section id="competitors" title="Compared with competitors" lede={typed.length ? "The competitor sites you gave us could not be read." : "No competitors were compared in this run."}>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {typed.length
            ? `We could not read ${unreadList}; ${typed.length === 1 && unreadable.length <= 1 ? "it is" : "they are"} listed but not compared. Check the address opens in your browser, or try the competitor's main page.`
            : run.mode === "demo"
              ? "Add one to three competitor websites on the start page and run again to see the comparison."
              : "We could not find any competitor sites this time. Add one to three competitor websites on the start page and run again."}
        </p>
      </Section>
    );
  }
  return (
    <Section id="competitors" title="Compared with competitors" lede="Only what public pages show. A rival may keep booking or chat behind a login.">
      <div className="grid gap-3 md:grid-cols-3">
        {run.competitors.map((c) => (
          <div key={c.url} className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{c.name}</span>
              {!c.features && <span className="chip">could not be read</span>}
            </div>
            <a href={c.url} target="_blank" rel="noreferrer" className="tap block truncate text-xs" style={{ color: "var(--muted)" }}>
              {c.url}
            </a>
            <p className="mt-2 text-sm">{c.offering}</p>
            {c.strengths.length > 0 && (
              <ul className="mt-2 text-xs">
                {c.strengths.slice(0, 3).map((s) => (
                  <li key={s}>+ {properFeatureCase(s)}</li>
                ))}
                {c.notesFrom === "web" && <li style={{ color: "var(--muted)" }}>from web search, not verified against their pages</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
      {unreadable.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          We could not read {unreadable.map((c) => c.url).join(", ")}; {unreadable.length === 1 ? "it is" : "they are"} listed but not compared.
        </p>
      )}
      <div className="panel mt-3 px-1">
        <Scrollable>
          <table className="w-full text-sm">
            <caption className="px-2 pt-2 pb-1 text-left text-xs" style={{ color: "var(--muted)" }}>
              What each public website offers customers <Badge kind="compared" />
            </caption>
            <thead>
              <tr className="text-left text-[11px] uppercase" style={{ color: "var(--muted)", letterSpacing: ".04em" }}>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Feature
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  {company.name}
                </th>
                {compared.map((c) => (
                  <th key={c.url} scope="col" className="px-2 py-2 font-semibold">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_KEYS.map((k) => (
                <tr key={k} className="border-t" style={{ borderColor: "var(--rule)" }}>
                  <th scope="row" className="px-2 py-1.5 text-left font-normal">
                    {FEATURE_LABELS[k]}
                  </th>
                  <td className="px-2 py-1.5">
                    <YesNo v={company.features ? !!company.features[k] : null} />
                  </td>
                  {compared.map((c) => (
                    <td key={c.url} className="px-2 py-1.5">
                      <YesNo v={c.features ? !!c.features[k] : null} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Scrollable>
      </div>
      <div className="mt-4">
        <p className="text-sm font-semibold">
          Ways customers can help themselves, you vs competitors <Badge kind="compared" />
        </p>
        <SelfServeDots selfServe={impact.selfServe} companyName={company.name} afterBuild={afterBuild} />
      </div>
    </Section>
  );
}

function Recommendations({ run, impact, tools, onBuilt, onBuilding, minutesRange, waitLabel, waitAppliesTo, personLabel, companyName, tech }: { run: RunDoc; impact: Impact; tools: BuiltTool[]; onBuilt: () => Promise<unknown>; onBuilding: (b: boolean) => void; minutesRange: [number, number] | null; waitLabel: string | null; waitAppliesTo: "all" | "email"; personLabel: string; companyName: string; tech: string[] }) {
  const [selected, setSelected] = useState<string>(run.opportunities[0]?.templateId ?? "");
  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [offLimits, setOffLimits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The newest log entry when Build was pressed; only entries written after it belong to this build.
  const [buildSince, setBuildSince] = useState<string | null>(null);
  const template = TEMPLATES.find((t) => t.id === selected);
  const primaryTool = tools[0] ?? null;
  const ownerQuestions = run.intake?.topQuestions ?? [];

  async function build() {
    setBusy(true);
    onBuilding(true);
    setError(null);
    setBuildSince(run.log[run.log.length - 1]?.t ?? new Date(0).toISOString());
    try {
      const res = await fetch(`/api/runs/${run._id}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: selected, name, tone, offLimits: offLimits.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The build did not finish. Please try again.");
      await onBuilt();
      document.getElementById("tested")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBuilding(false);
    }
  }
  const buildLog = buildSince === null ? [] : run.log.filter((l) => l.t > buildSince);

  const expectRows: { label: string; low: number; high: number | null; note?: string }[] = [];
  if (impact.load) expectRows.push({ label: "Routine questions now", low: impact.load.low, high: impact.load.high });
  if (impact.couldMove?.kind === "range" && impact.couldMove.low !== null && impact.couldMove.high !== null) expectRows.push({ label: impact.couldMove.label, low: impact.couldMove.low, high: impact.couldMove.high, note: impact.couldMove.note });
  if (impact.couldMove?.kind === "atMost" && impact.couldMove.atMost !== null) expectRows.push({ label: impact.couldMove.label, low: impact.couldMove.atMost, high: null, note: impact.couldMove.note });

  const st = impact.selfTest;
  const selfTestSentence = st
    ? `It answered ${st.answered} of ${st.total} test questions on the spot` +
      (st.handedOff ? `, and handed ${st.handedOff} to you with your contact details` : "") +
      (st.failed ? `; ${st.failed} failed` : "") +
      "." +
      (st.handedOff || st.failed ? " Those still come to you." : " In the test, nothing needed to come to you; real customers will still ask things it cannot answer, and those reach you with your contact details.")
    : "";

  return (
    <>
      <Section id="recommendation" title="One tool we recommend, and two alternatives" lede="Pick one to build. The best fit is selected. Ranked by the evidence above and by how much of what it needs is already written down. No scores, just reasons.">
        <div className="grid gap-3 md:grid-cols-3">
          {run.opportunities.map((o, i) => {
            const t = TEMPLATES.find((x) => x.id === o.templateId);
            const r = impact.reasons[o.templateId];
            const active = selected === o.templateId;
            return (
              <button
                key={o.templateId}
                type="button"
                onClick={() => setSelected(o.templateId)}
                className="panel grid content-start p-4 text-left"
                aria-pressed={active}
                style={{ borderColor: active ? "var(--accent)" : undefined, boxShadow: active ? "0 0 0 2px var(--accent-soft)" : undefined }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="eyebrow">{i === 0 ? "Best fit" : "Alternative"}</span>
                  <span className="flex flex-wrap gap-1">
                    <span className={"chip " + (o.fit === "strong" ? "chip-good" : o.fit === "possible" ? "chip-accent" : "")}>{o.fit === "strong" ? "strong evidence" : o.fit === "possible" ? "some evidence" : "general fit only"}</span>
                    {active && <span className="chip chip-accent">Selected</span>}
                  </span>
                </div>
                <div className="mt-1 font-bold">{t?.name ?? o.templateId}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {t?.surface}
                </div>
                <p className="mt-2 text-sm">{t?.summary}</p>
                {r && (
                  <ul className="mt-2 grid gap-1 text-xs" style={{ color: "var(--muted)" }}>
                    <li>
                      <b style={{ color: "var(--ink)" }}>Because:</b>{" "}
                      {r.quotes || r.missing
                        ? [r.quotes ? `${r.quotes} quote${r.quotes === 1 ? "" : "s"} from your site or from you` : "", r.missing ? `${r.missing} thing${r.missing === 1 ? "" : "s"} missing from the site` : ""].filter(Boolean).join(", ")
                        : "no specific evidence; ranked on general fit"}
                    </li>
                    <li>
                      <b style={{ color: "var(--ink)" }}>Needs:</b> {r.needs.covered} of {r.needs.total} topics written down{r.needs.missing.length ? ` (missing: ${r.needs.missing.join(", ")})` : ""}
                    </li>
                    <li>
                      <b style={{ color: "var(--ink)" }}>For the customer:</b> {r.customerChange}
                    </li>
                  </ul>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      {template && (
        <section className="mt-10" id="build">
          <h2 className="section-title fade-in" key={template.id} aria-live="polite">
            Build the {template.name}
          </h2>
          <p className="lede mt-1">
            {template.ownerBenefit} Building takes about a minute: we assemble it from your pages and files, then test it on ten questions before you see it.
          </p>
          <div className="mt-3 panel grid gap-4 p-5 md:grid-cols-2">
            <div className="grid gap-3">
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                This will build the <b style={{ color: "var(--ink)" }}>{template.name}</b> ({template.surface.toLowerCase()}). Pick a different card above to change it.
              </p>
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Name your assistant</span>
                <input id="tool-name" className="input" placeholder={`e.g. Ask ${companyName.split(" ")[0]}`} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Tone</span>
                <input id="tool-tone" className="input" placeholder="Friendly and straightforward" value={tone} onChange={(e) => setTone(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Topics it should hand to a person instead</span>
                <input id="tool-offlimits" className="input" placeholder="e.g. medical advice, discounts (comma-separated)" value={offLimits} onChange={(e) => setOffLimits(e.target.value)} />
              </label>
              {error && (
                <p className="text-sm" role="alert" style={{ color: "var(--bad)" }}>
                  {error}
                </p>
              )}
              <div>
                <button className="btn" type="button" onClick={build} disabled={busy} aria-busy={busy}>
                  {busy ? "Building and testing…" : primaryTool ? "Build again" : "Build and test"}
                </button>
                {busy && (
                  <ul className="mt-2 grid gap-0.5 text-xs" style={{ color: "var(--muted)" }} aria-live="polite">
                    {buildLog.length === 0 && <li>Assembling the assistant…</li>}
                    {buildLog.map((l, i) => (
                      <li key={i}>{l.msg}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="text-sm">
              <p className="font-semibold">We will test it on</p>
              <ul className="mt-1 grid gap-0.5" style={{ color: "var(--muted)" }}>
                {template.mode === "chat" &&
                  ownerQuestions.map((q) => (
                    <li key={q}>★ {q}</li>
                  ))}
                <li>
                  {template.mode === "form"
                    ? template.id === "review_responder"
                      ? "10 sample reviews written to match your business (your listed questions apply to chat assistants)."
                      : "10 product facts taken from your site where possible (your listed questions apply to chat assistants)."
                    : ownerQuestions.length
                      ? `plus ${Math.max(0, 10 - ownerQuestions.length)} questions we write from your site`
                      : "10 questions we write from your site. List your own most-asked questions above for a fairer test."}
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {tools.length > 0 && (
        <Section id="tested" title="Your assistant, tested" lede="Newest first. A hand-off is a good outcome: the customer gets your contact details at once instead of a wrong answer.">
          <div id="built" className="grid gap-4">
            {tools.map((t, i) => (
              <BuiltToolCard key={t._id} tool={t} latest={i === 0} minutesRange={minutesRange} demo={run.mode === "demo"} tech={tech} />
            ))}
          </div>
        </Section>
      )}

      <Section id="expect" title="What to expect" lede={primaryTool ? "With the assistant in front of your inbox, every route still ends with a person for anything it cannot answer." : "Build and test the assistant to fill this in with measured numbers."}>
        <RouteDiagram channels={impact.channels} after selfTest={impact.selfTest} waitLabel={waitLabel} waitAppliesTo={waitAppliesTo} personLabel={personLabel} selfServe={impact.selfServe.company.features} />
        {expectRows.length > 0 ? (
          <div className="mt-4">
            <p className="text-sm font-semibold">
              Hours per week <Badge kind="you" /> <Badge kind="estimate" />
            </p>
            <RangeBar rows={expectRows} unit="h/week" />
            {impact.couldMove?.arithmetic && (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {impact.couldMove.arithmetic}. {impact.couldMove.note}
              </p>
            )}
            {impact.value && (
              <p className="mt-2 text-sm">
                {impact.value.kind === "range" ? `Worth about $${impact.value.low}–$${impact.value.high} a week` : `Worth up to $${impact.value.high} a week`} at the hourly value you entered <Badge kind="you" /> <Badge kind="estimate" />. Time you could spend on something else, not new revenue.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Add one number in{" "}
            <a href="#intake" style={{ color: "var(--accent)" }}>
              Add what you know
            </a>{" "}
            (questions per week) to see hours here.
          </p>
        )}
        <div className="mt-4">
          <p className="text-sm font-semibold">How long a customer waits for a first answer</p>
          <WaitBars today={impact.wait.today} assistantSeconds={impact.wait.assistantSeconds} />
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Today&apos;s wait is what you told us or what your site promises, not a measurement.
            {waitAppliesTo === "email" ? " The promise on your site is about email; we found nothing for phone or walk-in." : ""} Questions the assistant hands off still wait for you.
          </p>
        </div>
        {st && <p className="mt-3 text-sm">{selfTestSentence}</p>}
      </Section>
    </>
  );
}

function suggestedFix(e: EvalCase): string {
  if (/does not match|Neither/.test(e.note)) return "Upload the document that answers this, or add the topic under “hand to a person” so it hands off instead of guessing.";
  if (/errored/i.test(e.note)) return "The tool hit an error on this one. Build again; if it repeats, ask whoever set this up to check the server.";
  return "Add the missing information above, then build again.";
}

function platformHint(tech: string[]): string {
  if (tech.includes("Squarespace")) return "Squarespace: Settings → Advanced → Code Injection → Footer, paste, save.";
  if (tech.includes("Shopify")) return "Shopify: Online Store → Themes → Edit code → theme.liquid, paste just above </body>.";
  if (tech.includes("Wix")) return "Wix: Settings → Custom code → Add custom code, place in Body – end, all pages.";
  if (tech.includes("WordPress")) return "WordPress: use a header-and-footer scripts plugin and paste into the footer, or ask your web person.";
  if (tech.includes("Webflow")) return "Webflow: Project settings → Custom code → Footer code, paste, publish.";
  return "Paste it just before </body> on your site, or send this line to whoever manages your website.";
}

function BuiltToolCard({ tool, latest, minutesRange, demo, tech }: { tool: BuiltTool; latest: boolean; minutesRange: [number, number] | null; demo: boolean; tech: string[] }) {
  const [open, setOpen] = useState(latest);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const t = TEMPLATES.find((x) => x.id === tool.templateId);
  const snippet = `<script src="${origin}/embed.js?tool=${tool._id}" async></script>`;
  const answered = tool.evals.filter((e) => e.outcome === "answered").length;
  const handed = tool.evals.filter((e) => e.outcome === "handed_off").length;
  const failed = tool.evals.length - answered - handed;
  const medianMs = (() => {
    const xs = tool.evals.map((e) => e.latencyMs).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  })();
  return (
    <div className="panel p-4" style={{ borderColor: latest ? "var(--accent)" : undefined }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{tool.config.name}</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            {t?.name} · built {new Date(tool.createdAt).toLocaleString()} · knows {tool.knowledgeCount} pages and files
            {tool.config.offLimits.length ? ` · hands off: ${tool.config.offLimits.join(", ")}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/t/${tool._id}`} target="_blank" className="btn">
            Try it live
          </Link>
          <button type="button" className="btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide details" : "Show details"}
          </button>
        </div>
      </div>
      <div className="mt-3">
        <OutcomeStrip evals={tool.evals} demo={demo} />
        <p className="mt-1 text-sm">
          {answered} of {tool.evals.length} answered on the spot, {handed} handed to you, {failed} failed. <Badge kind="tested" />{" "}
          {demo ? "Answers were instant in demo mode." : `About ${Math.max(1, Math.round(medianMs / 1000))} second${Math.round(medianMs / 1000) === 1 ? "" : "s"} per answer.`}
        </p>
      </div>
      {open && (
        <div className="mt-3 grid gap-4 text-sm">
          <div>
            <p className="eyebrow">Each test question</p>
            <ul className="mt-1 grid gap-1.5">
              {tool.evals.map((e, i) => (
                <li key={i} className="rounded border p-2" style={{ borderColor: e.outcome === "failed" ? "#efc4c4" : "var(--rule)" }}>
                  <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 font-semibold" style={{ overflowWrap: "anywhere" }}>
                      {e.starred ? "★ " : ""}
                      {e.question}
                    </span>
                    <span className={"chip shrink-0 " + (e.outcome === "answered" ? "chip-good" : e.outcome === "handed_off" ? "chip-accent" : "chip-bad")}>{e.outcome === "answered" ? "answered" : e.outcome === "handed_off" ? "handed to you" : "failed"}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-xs" style={{ overflowWrap: "anywhere" }}>
                    {e.answer}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {e.note}
                    {e.outcome === "failed" && <> · Fix: {suggestedFix(e)}</>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow">Put it on your website</p>
            <div className="mt-1 flex flex-wrap items-start gap-2">
              <pre className="mono min-w-0 flex-1 overflow-x-auto rounded p-2" style={{ background: "var(--paper)" }}>
                {snippet}
              </pre>
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(snippet);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* selectable text remains */
                  }
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {platformHint(tech)} A chat bubble appears bottom-right in your brand colour. You can also share the &ldquo;Try it live&rdquo; link directly.
            </p>
          </div>
          <div>
            <p className="eyebrow">Owner&apos;s guide</p>
            <ul className="mt-1 grid gap-1">
              <li>
                <b>What it does:</b> {t?.summary}
              </li>
              <li>
                <b>What it will not do:</b> invent prices, hours, or policies; discuss competitors; handle complaints or refunds (it hands those to you)
                {tool.config.offLimits.length ? `; talk about ${tool.config.offLimits.join(", ")}` : ""}.
              </li>
              <li>
                <b>To update what it knows:</b> add or replace a document in “Add what you know”, or update your website, then build again.
              </li>
              <li>
                <b>To turn it off:</b> remove the line from your site. Nothing else changes.
              </li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">
              Since it went live <Badge kind="measured" />
            </p>
            <div className="mt-1">
              <UsagePanel slug={tool._id} minutesRange={minutesRange} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
