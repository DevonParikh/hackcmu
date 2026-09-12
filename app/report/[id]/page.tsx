// Screen 2 (report) and the top of Screen 3 (the plan). Graphs first, bullets second, every chip a link.

import { ObjectId } from "mongodb";
import Link from "next/link";
import { db } from "@/lib/db";
import { templateById, type Run, type Evidence } from "@/lib/schemas";
import TimeSink from "@/components/charts/TimeSink";
import Coverage from "@/components/charts/Coverage";
import BeforeAfter from "@/components/charts/BeforeAfter";
import HowItFits from "@/components/diagrams/HowItFits";

export const dynamic = "force-dynamic";

const dot: Record<string, string> = { low: "bg-line", medium: "bg-blue/60", high: "bg-blue" };

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run: Run | null = null;
  try { run = (await (await db()).collection("runs").findOne({ _id: new ObjectId(id) })) as Run | null; } catch {}
  if (!run) return <main className="mx-auto max-w-2xl px-6 py-16">That report doesn't exist. <Link href="/" className="text-blue underline">Start over</Link></main>;

  const src = run.sources ?? [];
  const Chip = ({ e }: { e: Evidence }) => {
    const s = src[e.source];
    const inner = <span className="inline-block max-w-full truncate rounded-md border border-line bg-panel px-2 py-0.5 text-sm text-muted align-middle">“{e.quote}”</span>;
    return s?.url && /^https?:/.test(s.url) ? <a href={s.url} target="_blank" rel="noopener" className="max-w-full">{inner}</a> : inner;
  };

  if (run.stage === "failed") return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p>We couldn't finish reading that site: {run.error}</p>
      <Link href="/" className="text-blue underline">Try another</Link>
    </main>
  );

  const a = run.assessment, r = run.ranking, p = run.profile;
  const top = r?.top[0];
  const tpl = top ? templateById(top.template) : undefined;
  const company = run.name ?? p?.name ?? new URL(run.url).hostname;

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <p className="text-muted"><Link href="/" className="underline">Tailor</Link> · <a href={run.url} target="_blank" rel="noopener" className="underline">{new URL(run.url).hostname}</a></p>
      <h1 className="mt-2 text-3xl font-semibold">{company}</h1>
      {p && <p className="mt-2 max-w-lg text-muted">{p.offering}</p>}
      {run.stage !== "ranked" && <p className="mt-6 rounded-md border border-line bg-panel p-4 text-muted">Still reading… refresh in a moment. Stage: {run.stage}.</p>}

      {a && (
        <section className="mt-12">
          <h2 className="text-lg font-medium">Where {company}'s week goes</h2>
          <div className="mt-4"><TimeSink rows={a.frictionSignals} /></div>
          <ul className="mt-6 space-y-3">
            {[...a.frictionSignals].sort((x, y) => y.hoursPerWeek - x.hoursPerWeek).map(f => (
              <li key={f.task} className="flex flex-wrap items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot[f.confidence]}`} title={`${f.confidence} confidence`} aria-label={`${f.confidence} confidence`} />
                <span className="font-medium">{f.task}</span>
                <span className="text-muted">— {f.who}</span>
                {f.evidence.slice(0, 2).map((e, i) => <Chip key={i} e={e} />)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {a && (
        <section className="mt-12">
          <h2 className="text-lg font-medium">What customers ask, and what the site answers</h2>
          <div className="mt-4"><Coverage total={a.coverage.questions.length} answerable={a.coverage.questions.filter(q => q.answerable).length} /></div>
          <details className="mt-3 text-sm text-muted"><summary className="cursor-pointer">See the questions</summary>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">{a.coverage.questions.map((q, i) => <li key={i} className={q.answerable ? "" : "text-red"}>{q.answerable ? "✓" : "✗"} {q.text}</li>)}</ul>
          </details>
        </section>
      )}

      {run.benchmark && run.benchmark.competitors.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-medium">You and nearby competitors</h2>
          <table className="mt-4 w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="py-1 pr-4 font-normal">Business</th><th className="py-1 pr-4 font-normal">Replies to reviews</th><th className="py-1 pr-4 font-normal">FAQ</th><th className="py-1 font-normal">Online booking</th></tr></thead>
            <tbody>
              {[{ name: company, ...run.benchmark.you }, ...run.benchmark.competitors].map((c, i) => (
                <tr key={i} className={`border-t border-line ${i === 0 ? "font-medium" : ""}`}>
                  <td className="py-2 pr-4">{c.name}</td>
                  <td className="py-2 pr-4">{c.reviewReplyDays == null ? "—" : `${c.reviewReplyDays} day${c.reviewReplyDays === 1 ? "" : "s"}`}</td>
                  <td className="py-2 pr-4">{c.hasFaq == null ? "—" : c.hasFaq ? "yes" : "no"}</td>
                  <td className="py-2">{c.hasOnlineBooking == null ? "—" : c.hasOnlineBooking ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {a && (a.strengths.length > 0 || a.weaknesses.length > 0) && (
        <section className="mt-12 grid gap-8 sm:grid-cols-2">
          <div><h2 className="text-lg font-medium">Doing well</h2>
            <ul className="mt-3 space-y-3">{a.strengths.map((s, i) => <li key={i}>{s.text} <Chip e={s.evidence[0]} /></li>)}</ul></div>
          <div><h2 className="text-lg font-medium">Not doing well</h2>
            <ul className="mt-3 space-y-3">{a.weaknesses.map((s, i) => <li key={i}>{s.text} <Chip e={s.evidence[0]} /></li>)}</ul></div>
        </section>
      )}

      {r && top && tpl && (
        <section className="mt-16 rounded-lg border border-line bg-panel p-6">
          <p className="text-muted">The one tool worth building</p>
          <h2 className="mt-1 text-2xl font-semibold">{tpl.name}</h2>
          <p className="mt-2 max-w-lg">{top.why}</p>
          {r.belowThreshold && <p className="mt-2 text-red">Honestly: the numbers here are small. It may not be worth building anything yet.</p>}
          <div className="mt-6"><HowItFits toolName={tpl.name} company={company} money={tpl.money} booking={tpl.id === "booking-intake"} /></div>
          <div className="mt-6"><BeforeAfter task={top.addresses} hoursNow={top.hoursNow} hoursAfter={top.hoursAfter} assumption={top.assumption} /></div>
          {r.top.length > 1 && (
            <p className="mt-6 text-sm text-muted">Also considered: {r.top.slice(1).map(o => templateById(o.template)?.name).filter(Boolean).join(", ")}.</p>
          )}
          <p className="mt-6 text-sm text-muted">Build and deploy come next. (Screen 3 controls: rename, tone, off-limits topics, refund allowance.)</p>
        </section>
      )}
    </main>
  );
}
