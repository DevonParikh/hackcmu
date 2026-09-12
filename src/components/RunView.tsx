"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TEMPLATES } from "@/lib/templates";
import { FEATURE_KEYS, FEATURE_LABELS, type CompanyDoc, type Evidence, type EvalCase, type RunDoc } from "@/lib/types";

type BuiltTool = {
  _id: string;
  templateId: string;
  mode: "chat" | "form";
  config: { name: string; tone: string; offLimits: string[]; greeting: string; brand: { primary: string } };
  evals: EvalCase[];
  evalSummary: { passed: number; total: number };
  knowledgeCount: number;
};
type Payload = { run: RunDoc; company: CompanyDoc | null; tools: BuiltTool[] };

const STAGES: { key: RunDoc["stage"]; label: string }[] = [
  { key: "ingest", label: "Read site" },
  { key: "profile", label: "Profile" },
  { key: "competitors", label: "Competitors" },
  { key: "assess", label: "Assess" },
  { key: "rank", label: "Rank" },
  { key: "done", label: "Done" },
];

export function RunView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load the run");
      setData(json);
      setError(null);
      return json as Payload;
    } catch (e) {
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
      if (!d || d.run.status === "queued" || d.run.status === "running") timer = setTimeout(tick, 1500);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [load]);

  if (error && !data)
    return (
      <main className="mx-auto max-w-3xl px-5 py-12">
        <p style={{ color: "var(--bad)" }}>{error}</p>
      </main>
    );
  if (!data)
    return (
      <main className="mx-auto max-w-3xl px-5 py-12" style={{ color: "var(--muted)" }}>
        Loading…
      </main>
    );

  const { run, company } = data;
  const running = run.status === "queued" || run.status === "running";
  const stageIdx = STAGES.findIndex((s) => s.key === run.stage);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
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
          {run.status === "failed" && <span className="chip chip-bad">Failed</span>}
        </div>
      </div>

      <section className="panel mt-6 p-4">
        <p className="eyebrow">Progress</p>
        <ul className="mono mt-2 max-h-48 space-y-0.5 overflow-y-auto">
          {run.log.map((l, i) => (
            <li key={i} style={{ color: l.level === "error" ? "var(--bad)" : l.level === "warn" ? "var(--ochre)" : "var(--muted)" }}>
              <span className="opacity-60">{l.t.slice(11, 19)}</span> {l.msg}
            </li>
          ))}
          {running && <li style={{ color: "var(--accent)" }}>…</li>}
        </ul>
      </section>

      {run.status === "failed" && (
        <section className="panel mt-6 p-4" style={{ borderColor: "#efc4c4" }}>
          <p className="font-semibold" style={{ color: "var(--bad)" }}>
            The analysis stopped: {run.error}
          </p>
          <Link href="/" className="btn-ghost mt-3">
            Try another URL
          </Link>
        </section>
      )}

      {company?.profile && (
        <section className="mt-8 grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <div className="panel p-5">
            <p className="eyebrow">Company</p>
            <h2 className="mt-1 text-xl font-bold">{company.profile.tagline}</h2>
            <p className="mt-2 text-sm">{company.profile.offering}</p>
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Row k="Customers" v={company.profile.customerSegments.join(", ")} />
              <Row k="Business model" v={company.profile.businessModel} />
              <Row k="Pricing" v={company.profile.pricingSummary} />
              <Row k="Size" v={company.profile.sizeEstimate} />
              <Row k="Channels" v={company.profile.channels.join(", ")} />
              <Row k="Tone" v={company.profile.toneOfVoice} />
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
            <p className="eyebrow">Site checklist</p>
            <ul className="mt-2 grid gap-1 text-sm">
              {FEATURE_KEYS.map((k) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span>{FEATURE_LABELS[k]}</span>
                  <span className={"chip " + (company.features?.[k] ? "chip-good" : "chip-bad")}>{company.features?.[k] ? "yes" : "no"}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
              Brand colors
              <span className="inline-block h-4 w-4 rounded" style={{ background: company.brand.primary }} />
              <span className="inline-block h-4 w-4 rounded" style={{ background: company.brand.secondary }} />
              <span className="mono">{company.brand.primary}</span>
            </div>
          </div>
        </section>
      )}

      {run.competitors.length > 0 && company && (
        <section className="mt-8">
          <p className="eyebrow">Competitors</p>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            {run.competitors.map((c) => (
              <div key={c.url} className="panel p-4">
                <div className="font-semibold">{c.name}</div>
                <a href={c.url} target="_blank" rel="noreferrer" className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                  {c.url}
                </a>
                <p className="mt-2 text-sm">{c.offering}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {c.why}
                </p>
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
        </section>
      )}

      {run.assessment && (
        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <ClaimList title="Doing well" claims={run.assessment.strengths} tone="good" />
          <ClaimList title="Not doing well" claims={run.assessment.weaknesses} tone="bad" />
          <div className="panel p-4">
            <p className="eyebrow">Friction signals</p>
            <ul className="mt-2 grid gap-3 text-sm">
              {run.assessment.frictionSignals.length === 0 && <li style={{ color: "var(--muted)" }}>None found.</li>}
              {run.assessment.frictionSignals.map((s) => (
                <li key={s.id}>
                  <div className="font-semibold">{s.task}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {s.who} · {s.frequency}
                  </div>
                  <EvidenceList evidence={s.evidence} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {run.status === "done" && <Recommendations run={run} tools={data.tools} onBuilt={load} />}
    </main>
  );
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
          “{e.quote}”{" "}
          {e.sourceUrl !== "user-input" && (
            <a href={e.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              source
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

function Recommendations({ run, tools, onBuilt }: { run: RunDoc; tools: BuiltTool[]; onBuilt: () => Promise<unknown> }) {
  const [selected, setSelected] = useState<string>(run.opportunities[0]?.templateId ?? "");
  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [offLimits, setOffLimits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = TEMPLATES.find((t) => t.id === selected);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${run._id}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: selected, name, tone, offLimits: offLimits.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Build failed");
      await onBuilt();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <p className="eyebrow">Recommended tools</p>
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        {run.opportunities.map((o, i) => {
          const t = TEMPLATES.find((x) => x.id === o.templateId);
          const active = selected === o.templateId;
          return (
            <button
              key={o.templateId}
              type="button"
              onClick={() => setSelected(o.templateId)}
              className="panel p-4 text-left"
              style={{ borderColor: active ? "var(--accent)" : undefined, boxShadow: active ? "0 0 0 2px var(--accent-soft)" : undefined }}
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow">{i === 0 ? "Best fit" : "Alternative"}</span>
                <span className="mono">score {o.score.toFixed(2)}</span>
              </div>
              <div className="mt-1 font-bold">{t?.name ?? o.templateId}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {t?.surface}
              </div>
              <p className="mt-2 text-sm">{o.rationale}</p>
              <div className="mt-3 grid grid-cols-3 gap-1 text-center text-xs">
                <Meter label="Impact" v={o.impact} />
                <Meter label="Evidence" v={o.evidenceStrength} />
                <Meter label="Data" v={o.dataAvailability} />
              </div>
            </button>
          );
        })}
      </div>

      {template && (
        <div className="panel mt-4 grid gap-4 p-5 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="eyebrow">Build {template.name}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {template.summary} {template.ownerBenefit}
            </p>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Assistant name</span>
                <input id="tool-name" className="input" placeholder="e.g. Ask Maple" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Tone</span>
                <input id="tool-tone" className="input" placeholder="Friendly and straightforward" value={tone} onChange={(e) => setTone(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Off-limits topics (comma-separated)</span>
                <input id="tool-offlimits" className="input" placeholder="e.g. medical advice, discounts" value={offLimits} onChange={(e) => setOffLimits(e.target.value)} />
              </label>
              {error && (
                <p className="text-sm" style={{ color: "var(--bad)" }}>
                  {error}
                </p>
              )}
              <div>
                <button className="btn" type="button" onClick={build} disabled={busy}>
                  {busy ? "Building and self-testing…" : "Build and self-test"}
                </button>
              </div>
            </div>
          </div>
          <div>
            <p className="eyebrow">Built tools</p>
            {tools.length === 0 ? (
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                Nothing built yet. Building takes a minute: it assembles the assistant from the site content and runs a self-test.
              </p>
            ) : (
              <ul className="mt-2 grid gap-3">
                {tools.map((t) => (
                  <BuiltToolCard key={t._id} tool={t} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="h-1.5 w-full rounded" style={{ background: "var(--rule)" }}>
        <div className="h-1.5 rounded" style={{ width: `${Math.round(v * 100)}%`, background: "var(--accent)" }} />
      </div>
      <div className="mt-0.5" style={{ color: "var(--muted)" }}>
        {label}
      </div>
    </div>
  );
}

function BuiltToolCard({ tool }: { tool: BuiltTool }) {
  const [open, setOpen] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const t = TEMPLATES.find((x) => x.id === tool.templateId);
  const snippet = `<script src="${origin}/embed.js?tool=${tool._id}" async></script>`;
  return (
    <li className="rounded-lg border p-3" style={{ borderColor: "var(--rule)" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{tool.config.name}</div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            {t?.name} · {tool.knowledgeCount} knowledge chunks
          </div>
        </div>
        <span className={"chip " + (tool.evalSummary.passed === tool.evalSummary.total ? "chip-good" : "chip-accent")}>
          self-test {tool.evalSummary.passed}/{tool.evalSummary.total}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href={`/t/${tool._id}`} target="_blank" className="btn-ghost">
          Open live tool ↗
        </Link>
        <button type="button" className="btn-ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide details" : "Embed, self-test, owner guide"}
        </button>
      </div>
      {open && (
        <div className="mt-3 grid gap-3 text-sm">
          <div>
            <p className="eyebrow">Embed on your site</p>
            <pre className="mono mt-1 overflow-x-auto rounded p-2" style={{ background: "var(--paper)" }}>
              {snippet}
            </pre>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Paste before <span className="mono">&lt;/body&gt;</span>. A chat bubble appears bottom-right. Or share the link above directly.
            </p>
          </div>
          <div>
            <p className="eyebrow">Self-test</p>
            <ul className="mt-1 grid gap-1.5">
              {tool.evals.map((e, i) => (
                <li key={i} className="rounded border p-2" style={{ borderColor: "var(--rule)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{e.question}</span>
                    <span className={"chip " + (e.pass ? "chip-good" : "chip-bad")}>{e.pass ? "pass" : "fail"}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-xs">{e.answer}</div>
                  <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {e.note}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow">Owner guide</p>
            <ul className="mt-1 grid gap-1 text-sm">
              <li>
                <b>What it does:</b> {t?.summary}
              </li>
              <li>
                <b>What it will not do:</b> invent prices, hours, or policies; discuss competitors; handle complaints or refunds (it hands those to you)
                {tool.config.offLimits.length ? `; talk about ${tool.config.offLimits.join(", ")}` : ""}.
              </li>
              <li>
                <b>To update facts:</b> update your website, then re-run the analysis and build again. The assistant only knows what your site says.
              </li>
              <li>
                <b>To turn it off:</b> remove the script tag from your site.
              </li>
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}
