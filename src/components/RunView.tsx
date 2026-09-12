"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, OutcomeStrip, RangeBar, RouteDiagram, SelfServeDots, TopicGrid, WaitBars } from "@/components/charts";
import { IntakePanel } from "@/components/IntakePanel";
import { UsagePanel } from "@/components/UsagePanel";
import { BUCKETS, BUCKET_LABELS } from "@/lib/buckets";
import type { Impact } from "@/lib/pipeline/impact";
import { TEMPLATES } from "@/lib/templates";
import { FEATURE_KEYS, FEATURE_LABELS, type CompanyDoc, type Evidence, type EvalCase, type RunDoc } from "@/lib/types";

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
  const stageIdx = STAGES.findIndex((s) => s.key === run.stage);
  const primaryTool = tools[0] ?? null;
  const hasFiles = sources.some((s) => s.kind === "user");
  const minutesKey = run.intake?.minutesPerInquiry;
  const minutesRange = minutesKey ? BUCKETS.minutes[minutesKey] : null;
  const waitLabel = impact?.wait.today ? impact.wait.today.label : null;
  const personLabel = "You or your staff";

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      {/* 1. Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{run.mode === "demo" ? "Report · demo mode" : "Report"}</p>
          <h1 className="text-3xl font-bold tracking-tight">{company?.name ?? run.url}</h1>
          <a href={run.url} target="_blank" rel="noreferrer" className="text-sm" style={{ color: "var(--muted)" }}>
            {run.url}
          </a>
        </div>
        <div className="flex flex-wrap gap-1">
          {STAGES.map((s, i) => (
            <span key={s.key} className={"chip " + (i < stageIdx || run.status === "done" ? "chip-good" : i === stageIdx && running ? "chip-accent" : "")}>
              {s.label}
            </span>
          ))}
          {run.status === "failed" && <span className="chip chip-bad">Stopped</span>}
        </div>
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
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
          Every number wears a badge saying where it came from:
          <Badge kind="site" /> <Badge kind="file" /> <Badge kind="compared" /> <Badge kind="you" /> <Badge kind="tested" /> <Badge kind="estimate" /> <Badge kind="measured" />
        </p>
      )}

      {/* 2. Progress */}
      <details className="panel mt-6 px-4 py-3" open={running}>
        <summary className="flex items-center justify-between text-sm font-semibold">
          <span>{running ? `Working: ${STAGES[stageIdx]?.label ?? "starting"}…` : `Progress log (${run.log.length} steps)`}</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {running ? "updates every few seconds" : "show"}
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
            If the site blocks automated reading, try again with a different page address, or add your documents on the start page so we have something to work from.
          </p>
          <Link href="/" className="btn-ghost mt-3">
            Try again
          </Link>
        </section>
      )}

      {/* 3. Company card and checklist */}
      {company?.profile && (
        <section className="mt-8 grid gap-4 md:grid-cols-[1.3fr_1fr]">
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

      {impact && company && (
        <>
          {/* 4. Where questions go today */}
          <Section title="Where customer questions go today" lede="Every way a customer can reach you, from your own pages, and where each one ends up.">
            <RouteDiagram channels={impact.channels} after={false} selfTest={null} waitLabel={waitLabel} personLabel={personLabel} />
            <p className="mt-2 flex flex-wrap gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
              {impact.channels.map((c) => (
                <span key={c.id} className="chip">
                  {c.label}
                  {c.url && (
                    <>
                      {" "}
                      <a href={c.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                        source
                      </a>
                    </>
                  )}
                </span>
              ))}
              {impact.wait.today?.source === "site" && impact.wait.today.quote && (
                <span>
                  Your site says &ldquo;{impact.wait.today.quote}&rdquo;{" "}
                  <a href={impact.wait.today.url ?? "#"} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                    source
                  </a>
                </span>
              )}
            </p>
          </Section>

          {/* 5. What is written down + intake */}
          <Section
            title="What is written down where an assistant can read it"
            lede={`${impact.writtenDown.covered} of ${impact.writtenDown.total} common customer topics are covered on your site${hasFiles ? " and files" : ""}. An assistant can only answer what is written down; the rows marked "not found" are the ones to fill.`}
          >
            <TopicGrid topics={impact.topics} hasFiles={hasFiles} />
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
          {run.competitors.length === 0 && (
            <Section title="Compared with competitors" lede="No competitors were compared in this run.">
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {run.mode === "demo"
                  ? "In demo mode, add one to three competitor websites on the start page and run again to see the comparison."
                  : "We could not find or read any competitor sites this time. Add one to three competitor websites on the start page and run again."}
              </p>
            </Section>
          )}
          {run.competitors.length > 0 && (
            <Section title="Compared with competitors" lede="Only what public pages show. A rival may keep booking or chat behind a login.">
              <div className="grid gap-3 md:grid-cols-3">
                {run.competitors.map((c) => (
                  <div key={c.url} className="panel p-4">
                    <div className="font-semibold">{c.name}</div>
                    <a href={c.url} target="_blank" rel="noreferrer" className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                      {c.url}
                    </a>
                    <p className="mt-2 text-sm">{c.offering}</p>
                    {c.strengths.length > 0 && (
                      <ul className="mt-2 text-xs">
                        {c.strengths.slice(0, 3).map((s) => (
                          <li key={s}>+ {s}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <div className="panel mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
                      <th className="px-3 py-2">Feature</th>
                      <th className="px-3 py-2">{company.name}</th>
                      {run.competitors.map((c) => (
                        <th key={c.url} className="px-3 py-2">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FEATURE_KEYS.map((k) => (
                      <tr key={k} className="border-t" style={{ borderColor: "var(--rule)" }}>
                        <td className="px-3 py-1.5">{FEATURE_LABELS[k]}</td>
                        <td className="px-3 py-1.5">{company.features?.[k] ? "✓" : "—"}</td>
                        {run.competitors.map((c) => (
                          <td key={c.url} className="px-3 py-1.5">
                            {c.features ? (c.features[k] ? "✓" : "—") : "?"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4">
                <p className="text-sm font-semibold">Ways customers can help themselves, you vs competitors</p>
                <SelfServeDots selfServe={impact.selfServe} companyName={company.name} afterBuild={!!primaryTool} />
              </div>
            </Section>
          )}

          {/* 7. Doing well / not */}
          {run.assessment && (
            <section className="mt-10 grid gap-4 md:grid-cols-2">
              <ClaimList title="Doing well" claims={run.assessment.strengths} tone="good" />
              <ClaimList title="Not doing well" claims={run.assessment.weaknesses} tone="bad" />
            </section>
          )}

          {/* 8. Chores */}
          {run.assessment && (
            <Section title="Chores that eat time" lede="Repetitive work we could see from your site and what you told us. Each one links to where we saw it.">
              <ul className="grid gap-3 md:grid-cols-2">
                {run.assessment.frictionSignals.length === 0 && <li style={{ color: "var(--muted)" }}>Nothing specific found. That usually means the site already lets customers help themselves.</li>}
                {run.assessment.frictionSignals.map((s) => (
                  <li key={s.id} className="panel p-3 text-sm">
                    <div className="font-semibold">{s.task}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {s.who} · {s.frequency} · <CostTag id={s.id} />
                    </div>
                    <EvidenceList evidence={s.evidence} />
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                {impact.load ? (
                  <>
                    <p className="text-sm font-semibold">
                      Time on routine questions now <Badge kind="you" />
                    </p>
                    <RangeBar rows={[{ label: "Routine questions, per week", low: impact.load.low, high: impact.load.high, badge: "you" }]} unit="h/week" />
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {impact.load.arithmetic}. Mapping used: {BUCKET_LABELS.share[run.intake?.routineShare ?? "unsure"]} = {Math.round(BUCKETS.share[run.intake?.routineShare ?? "unsure"][0] * 100)}-
                      {Math.round(BUCKETS.share[run.intake?.routineShare ?? "unsure"][1] * 100)}%; {BUCKET_LABELS.minutes[run.intake?.minutesPerInquiry ?? "unsure"]} = {BUCKETS.minutes[run.intake?.minutesPerInquiry ?? "unsure"][0]}-
                      {BUCKETS.minutes[run.intake?.minutesPerInquiry ?? "unsure"][1]} min. Your own guess, multiplied out; nothing here is measured yet.
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
                    <RangeBar rows={[{ label: "Drafting, per month", low: impact.drafting.low, high: impact.drafting.high, badge: "you" }]} unit="h/month" />
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {impact.drafting.arithmetic}.
                    </p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* 9-12. Recommendation, build, expect, deploy */}
          {run.status === "done" && (
            <Recommendations run={run} impact={impact} tools={tools} onBuilt={load} onBuilding={setBuilding} minutesRange={minutesRange} waitLabel={waitLabel} personLabel={personLabel} companyName={company.name} tech={company.tech} />
          )}

          {/* 13. Not checked */}
          <Section title="What we could not check" lede="So you can weigh the report fairly.">
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

function Section({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="section-title">{title}</h2>
      {lede && <p className="lede mt-1">{lede}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CostTag({ id }: { id: string }) {
  const tag = /support|faq|inquir|lead/.test(id) ? "customers wait" : /booking|order/.test(id) ? "no self-serve" : /review/.test(id) ? "unanswered in public" : /hiring/.test(id) ? "paid time" : "your time";
  return <span className="chip">{tag}</span>;
}

function pathLabel(u: string): string {
  try {
    const x = new URL(u);
    const path = x.pathname === "/" ? "home page" : x.pathname.replace(/^\//, "").replace(/\.html?$/, "").replace(/[-_/]+/g, " ");
    return path.length > 28 ? path.slice(0, 27) + "…" : path;
  } catch {
    return "source";
  }
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

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <ul className="mt-1 grid gap-0.5">
      {evidence.map((e, i) => (
        <li key={i} className="text-xs" style={{ color: "var(--muted)" }}>
          {e.observed ? e.quote : `“${e.quote}”`}{" "}
          {e.sourceUrl === "user-input" ? (
            <Badge kind="you" />
          ) : e.sourceUrl.startsWith("user-upload:") ? (
            <Badge kind="file" />
          ) : (
            <a href={e.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }} aria-label={`Open ${e.sourceUrl}`}>
              {pathLabel(e.sourceUrl)}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function ClaimList({ title, claims, tone }: { title: string; claims: { claim: string; evidence: Evidence[] }[]; tone: "good" | "bad" }) {
  return (
    <div className="panel p-4">
      <p className="eyebrow" style={{ color: tone === "good" ? "var(--good)" : "var(--bad)" }}>
        {title}
      </p>
      <ul className="mt-2 grid gap-3 text-sm">
        {claims.length === 0 && <li style={{ color: "var(--muted)" }}>Nothing with evidence.</li>}
        {claims.map((c, i) => (
          <li key={i}>
            <div className="font-semibold">{c.claim}</div>
            <EvidenceList evidence={c.evidence} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Recommendations({ run, impact, tools, onBuilt, onBuilding, minutesRange, waitLabel, personLabel, companyName, tech }: { run: RunDoc; impact: Impact; tools: BuiltTool[]; onBuilt: () => Promise<unknown>; onBuilding: (b: boolean) => void; minutesRange: [number, number] | null; waitLabel: string | null; personLabel: string; companyName: string; tech: string[] }) {
  const [selected, setSelected] = useState<string>(run.opportunities[0]?.templateId ?? "");
  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [offLimits, setOffLimits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = TEMPLATES.find((t) => t.id === selected);
  const primaryTool = tools[0] ?? null;
  const ownerQuestions = run.intake?.topQuestions ?? [];

  async function build() {
    setBusy(true);
    onBuilding(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${run._id}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: selected, name, tone, offLimits: offLimits.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The build did not finish. Please try again.");
      await onBuilt();
      document.getElementById("built")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBuilding(false);
    }
  }
  const recentLog = run.log.slice(-3);

  const expectRows: { label: string; low: number; high: number | null; badge: "you" | "estimate" | "measured"; note?: string }[] = [];
  if (impact.load) expectRows.push({ label: "Routine questions now", low: impact.load.low, high: impact.load.high, badge: "you" });
  if (impact.couldMove?.kind === "range" && impact.couldMove.low !== null && impact.couldMove.high !== null) expectRows.push({ label: "Could move to the assistant", low: impact.couldMove.low, high: impact.couldMove.high, badge: "estimate", note: impact.couldMove.note });
  if (impact.couldMove?.kind === "atMost" && impact.couldMove.atMost !== null) expectRows.push({ label: "Could move, at most", low: impact.couldMove.atMost, high: null, badge: "estimate", note: impact.couldMove.note });

  return (
    <>
      <Section title="One tool we recommend, and two alternatives" lede="Ranked by the evidence above and by how much of what it needs is already written down. No scores, just reasons.">
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
                className="panel p-4 text-left"
                aria-pressed={active}
                style={{ borderColor: active ? "var(--accent)" : undefined, boxShadow: active ? "0 0 0 2px var(--accent-soft)" : undefined }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow">{i === 0 ? "Best fit" : "Alternative"}</span>
                  <span className={"chip " + (o.fit === "strong" ? "chip-good" : o.fit === "possible" ? "chip-accent" : "")}>{o.fit === "strong" ? "strong evidence" : o.fit === "possible" ? "some evidence" : "general fit only"}</span>
                </div>
                <div className="mt-1 font-bold">{t?.name ?? o.templateId}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {t?.surface}
                </div>
                <p className="mt-2 text-sm">{t?.summary}</p>
                {r && (
                  <ul className="mt-2 grid gap-1 text-xs" style={{ color: "var(--muted)" }}>
                    <li>
                      <b style={{ color: "var(--ink)" }}>Because:</b> {r.signals ? `${r.signals} sign${r.signals === 1 ? "" : "s"} of this chore from ${r.sources} source${r.sources === 1 ? "" : "s"}` : "no specific evidence; ranked on general fit"}
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
        <Section title={`Build the ${template.name}`} lede={`${template.ownerBenefit} Building takes about a minute: we assemble it from your pages and files, then test it on ten questions before you see it.`}>
          <div className="panel grid gap-4 p-5 md:grid-cols-2">
            <div className="grid gap-3">
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
                  <ul className="mono mt-2 grid gap-0.5 text-xs" style={{ color: "var(--muted)" }} aria-live="polite">
                    {recentLog.map((l, i) => (
                      <li key={i}>{l.msg}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="text-sm">
              <p className="font-semibold">We will test it on</p>
              <ul className="mt-1 grid gap-0.5" style={{ color: "var(--muted)" }}>
                {ownerQuestions.map((q) => (
                  <li key={q}>★ {q}</li>
                ))}
                <li>
                  {ownerQuestions.length ? `plus ${Math.max(0, 10 - ownerQuestions.length)} questions we write from your site` : "10 questions we write from your site. List your own most-asked questions above for a fairer test."}
                </li>
              </ul>
            </div>
          </div>
        </Section>
      )}

      {tools.length > 0 && (
        <Section title="Your assistant, tested" lede="Newest first. A hand-off is a good outcome: the customer gets your contact details at once instead of a wrong answer.">
          <div id="built" className="grid gap-4">
            {tools.map((t, i) => (
              <BuiltToolCard key={t._id} tool={t} latest={i === 0} minutesRange={minutesRange} demo={run.mode === "demo"} tech={tech} />
            ))}
          </div>
        </Section>
      )}

      <Section title="What to expect" lede={primaryTool ? "With the assistant in front of your inbox, every route still ends with a person for anything it cannot answer." : "Build and test the assistant to fill this in with measured numbers."}>
        <RouteDiagram channels={impact.channels} after selfTest={impact.selfTest} inquiriesPerWeek={run.intake?.inquiriesPerWeek} waitLabel={waitLabel} personLabel={personLabel} />
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
                Worth about ${impact.value.low}–${impact.value.high} a week at the hourly value you entered <Badge kind="you" /> <Badge kind="estimate" />. Time you could spend on something else, not new revenue.
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
            Today&apos;s wait is what you told us or what your site promises, not a measurement. Questions the assistant hands off still wait for you.
          </p>
        </div>
        {impact.selfTest && (
          <p className="mt-3 text-sm">
            It answered {impact.selfTest.answered} of {impact.selfTest.total} test questions on the spot and handed {impact.selfTest.handedOff} to you with your contact details. The rest of your questions still come to you.
          </p>
        )}
      </Section>
    </>
  );
}

function suggestedFix(e: EvalCase): string {
  if (/does not match|Neither/.test(e.note)) return "Upload the document that answers this, or add the topic under “hand to a person” so it hands off instead of guessing.";
  if (/errored/i.test(e.note)) return "The tool hit an error on this one. Build again; if it repeats, check the server logs.";
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
            Try it live ↗
          </Link>
          <button type="button" className="btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide details" : "Details"}
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
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">
                      {e.starred ? "★ " : ""}
                      {e.question}
                    </span>
                    <span className={"chip " + (e.outcome === "answered" ? "chip-good" : e.outcome === "handed_off" ? "chip-accent" : "chip-bad")}>{e.outcome === "answered" ? "answered" : e.outcome === "handed_off" ? "handed to you" : "failed"}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-xs">{e.answer}</div>
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
