// Screen 2 (report) and the top of Screen 3 (the plan).
// The finding is the hero. The business's own colour is the accent. Every number shows its evidence.

import { ObjectId } from "mongodb";
import Link from "next/link";
import { db } from "@/lib/db";
import { templateById, type Run, type Evidence } from "@/lib/schemas";
import { safeAccent, roundHalf } from "@/lib/brand";
import TimeSink from "@/components/charts/TimeSink";
import Coverage from "@/components/charts/Coverage";
import BeforeAfter from "@/components/charts/BeforeAfter";
import HowItFits from "@/components/diagrams/HowItFits";

export const dynamic = "force-dynamic";

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run: Run | null = null;
  try { run = (await (await db()).collection("runs").findOne({ _id: new ObjectId(id) })) as Run | null; } catch {}
  if (!run) return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <p>That report doesn't exist.</p>
      <Link href="/" className="underline">Start over</Link>
    </main>
  );
  if (run.stage === "failed") return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <p>We couldn't finish reading that site: {run.error}</p>
      <Link href="/" className="mt-4 inline-block underline">Try another</Link>
    </main>
  );

  const a = run.assessment, r = run.ranking, p = run.profile;
  const company = p?.name || run.name || host(run.url);
  const accent  = safeAccent(run.brand?.colors?.[0]);
  const src     = run.sources ?? [];
  const signals = a ? [...a.frictionSignals].sort((x, y) => y.hoursPerWeek - x.hoursPerWeek) : [];
  const totalHours = roundHalf(signals.reduce((s, f) => s + f.hoursPerWeek, 0));
  const top = r?.top[0];
  const tpl = top ? templateById(top.template) : undefined;

  const Quote = ({ e }: { e: Evidence }) => {
    const s = src[e.source];
    const q = e.quote.length > 110 ? e.quote.slice(0, 108).trimEnd() + "…" : e.quote;
    const where = s ? (s.kind === "review" ? "reviews" : host(s.url)) : "";
    const tag = e.kind === "demonstrates" ? "shows it" : e.kind === "suggests" ? "suggests it" : "";
    const body = <>“{q}”{where && <span className="text-muted"> — {where}</span>}{tag && <span className="ml-2 text-xs text-muted">{tag}</span>}</>;
    return (
      <li className="text-[15px] leading-relaxed">
        {s?.url && /^https?:/.test(s.url)
          ? <a href={s.url} target="_blank" rel="noopener" className="hover:underline">{body}</a>
          : body}
      </li>
    );
  };

  return (
    <main className="mx-auto max-w-2xl px-6 pt-16 pb-32" style={{ ["--accent" as string]: accent }}>
      <p className="text-muted">
        <Link href="/" className="hover:underline">Tailor</Link> report for <a href={run.url} target="_blank" rel="noopener" className="text-ink hover:underline">{company}</a>
      </p>

      {run.stage !== "ranked" && (
        <p className="mt-6 text-muted">Still reading… refresh in a moment. ({run.stage})</p>
      )}
      {run.thin && (
        <p className="mt-6 max-w-md text-muted">This site draws most of its content with JavaScript, so we had less to go on than usual. Treat the estimates as rough.</p>
      )}

      {/* ---- the finding */}
      {signals.length > 0 && (
        <header className="mt-8">
          <h1 className="display text-[clamp(32px,5.6vw,52px)] font-semibold leading-[1.05]">
            About <span className="tnum" style={{ color: accent }}>{totalHours} hours</span> a week go to things a small AI tool could do.
          </h1>
          <p className="mt-4 max-w-md text-muted">
            The biggest one: {signals[0].task}. Estimated from {src.length} sources; every number below links to where it came from.
            {run.timings?.rank != null && <> Analysed in {Math.round(run.timings.rank)} seconds.</>}
          </p>
          {run.quickEstimate?.template && (
            <p className="mt-3 max-w-md text-sm text-muted">
              Before reading a word, our structure model guessed <span className="text-ink">{run.quickEstimate.template.name}</span>
              {" "}({Math.round(run.quickEstimate.template.prob * 100)}%){run.quickEstimate.template.reasons.length ? ` from ${run.quickEstimate.template.reasons.map(r => r.label).join(", ")}` : ""}.
              {top && tpl ? (tpl.id === run.quickEstimate.template.id ? " The full read agreed." : ` The full read chose ${tpl.name} instead.`) : ""}
              {" "}Trained on {run.quickEstimate.n} businesses; right {Math.round(run.quickEstimate.template.acc * 100)}% of the time in cross-validation, against {Math.round(run.quickEstimate.template.baseline * 100)}% for always guessing the commonest tool.
            </p>
          )}
        </header>
      )}

      {/* ---- C1 */}
      {a && (
        <section className="mt-16 border-t border-line pt-8">
          <h2 className="display text-[22px] font-medium">Where the week goes</h2>
          <div className="mt-5"><TimeSink rows={signals} accent={accent} /></div>
          <p className="text-sm text-muted">
            Hours per week, estimated. Confidence is earned: high needs two sources showing the task happening.
            {run.verification && ` Every quote was checked against its source — ${run.verification.checked} checked, ${run.verification.dropped} dropped.`}
          </p>
          <ol className="mt-8 space-y-7">
            {signals.map(f => (
              <li key={f.task}>
                <p className="font-medium leading-snug">{f.task}</p>
                <p className="mt-1 text-sm text-muted">{f.who} · estimate, {f.confidence} confidence</p>
                <ul className="mt-2 space-y-1 border-l-2 pl-3" style={{ borderColor: accent }}>
                  {f.evidence.slice(0, 2).map((e, i) => <Quote key={i} e={e} />)}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ---- C2 */}
      {a && a.coverage.questions.length > 0 && (
        <section className="mt-16 border-t border-line pt-8">
          <h2 className="display text-[22px] font-medium">
            Customers ask about {a.coverage.questions.length} things. The site answers {a.coverage.questions.filter(q => q.answerable).length}.
          </h2>
          <p className="mt-2 mb-6 max-w-md text-muted">The rest becomes a phone call, an email, or a customer who goes elsewhere.</p>
          <Coverage questions={a.coverage.questions} accent={accent} />
        </section>
      )}

      {/* ---- C3 */}
      {run.benchmark && run.benchmark.competitors.length > 0 && (
        <section className="mt-16 border-t border-line pt-8">
          <h2 className="display text-[22px] font-medium">Next to nearby competitors</h2>
          <table className="mt-5 w-full text-[15px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-2 pr-4 font-normal">Business</th>
                <th className="pb-2 pr-4 font-normal">Replies to reviews</th>
                <th className="pb-2 pr-4 font-normal">FAQ page</th>
                <th className="pb-2 font-normal">Online booking</th>
              </tr>
            </thead>
            <tbody>
              {[{ name: company, ...run.benchmark.you }, ...run.benchmark.competitors].map((c, i) => (
                <tr key={i} className={`border-t border-line ${i === 0 ? "font-medium" : ""}`}>
                  <td className="py-2.5 pr-4">{c.name}</td>
                  <td className="py-2.5 pr-4 tnum">{c.reviewReplyDays == null ? "—" : `${c.reviewReplyDays} day${c.reviewReplyDays === 1 ? "" : "s"}`}</td>
                  <td className="py-2.5 pr-4">{c.hasFaq == null ? "—" : c.hasFaq ? "yes" : "no"}</td>
                  <td className="py-2.5">{c.hasOnlineBooking == null ? "—" : c.hasOnlineBooking ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {run.stage === "ranked" && !run.benchmark && (
        <p className="mt-16 border-t border-line pt-8 text-sm text-muted">Still looking at nearby competitors — refresh in a moment.</p>
      )}

      {/* ---- strengths / weaknesses */}
      {a && (a.strengths.length > 0 || a.weaknesses.length > 0) && (
        <section className="mt-16 grid gap-10 border-t border-line pt-8 sm:grid-cols-2">
          <div>
            <h2 className="display text-[22px] font-medium">Doing well</h2>
            <ul className="mt-4 space-y-4">
              {a.strengths.map((s, i) => (
                <li key={i}><p>{s.text}</p><ul className="mt-1 border-l-2 border-line pl-3"><Quote e={s.evidence[0]} /></ul></li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="display text-[22px] font-medium">Not doing well</h2>
            <ul className="mt-4 space-y-4">
              {a.weaknesses.map((s, i) => (
                <li key={i}><p>{s.text}</p><ul className="mt-1 border-l-2 border-line pl-3"><Quote e={s.evidence[0]} /></ul></li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ---- the plan: D1 + C4 */}
      {r && top && tpl && (
        <section className="mt-20 border-t-2 pt-10" style={{ borderColor: accent }}>
          <p className="text-muted">The one tool worth building</p>
          <h2 className="display mt-1 text-[clamp(28px,4.6vw,40px)] font-semibold leading-tight">{tpl.name}</h2>
          <p className="mt-4 max-w-lg">{top.why}</p>
          {r.belowThreshold && <p className="mt-3 text-red">Honestly: the numbers here are small. It may not be worth building anything yet.</p>}

          <h3 className="mt-10 text-[15px] text-muted">How it fits into the day</h3>
          <div className="mt-3"><HowItFits toolName={tpl.name} company={company} money={tpl.money} booking={tpl.id === "booking-intake"} accent={accent} /></div>

          <h3 className="mt-10 text-[15px] text-muted">{top.addresses}</h3>
          <div className="mt-3"><BeforeAfter hoursNow={top.hoursNow} hoursAfter={top.hoursAfter} assumption={top.assumption} accent={accent} /></div>

          {r.top.length > 1 && (
            <p className="mt-8 text-sm text-muted">
              Also considered: {r.top.slice(1).map(o => templateById(o.template)?.name).filter(Boolean).join(", ")}.
            </p>
          )}
          <Link href={`/build/${id}`} className="mt-8 inline-block rounded-md px-6 py-3 text-white" style={{ background: accent }}>
            Build this tool
          </Link>
        </section>
      )}
    </main>
  );
}
