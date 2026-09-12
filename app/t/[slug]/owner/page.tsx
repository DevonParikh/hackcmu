// Screen 5 — the owner's view of a deployed tool: what it handled, what it handed off, every refund with its verdict,
// and the allowance left on chain. This is the "after" half of the story.
import Link from "next/link";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { chainState } from "@/lib/money";
import { safeAccent } from "@/lib/brand";
import { templateById, type Tool, type ToolEvent, type Run } from "@/lib/schemas";
import Handled from "@/components/charts/Handled";
import BeforeAfter from "@/components/charts/BeforeAfter";

export const dynamic = "force-dynamic";

export default async function Owner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await db();
  const tool = await d.collection<Tool>("tools").findOne({ slug });
  if (!tool) return <main className="mx-auto max-w-2xl px-6 py-24"><p>No such tool.</p></main>;
  const events = await d.collection<ToolEvent>("events").find({ slug }).sort({ ts: -1 }).limit(500).toArray();
  let run: Run | null = null;
  try { run = (await d.collection("runs").findOne({ _id: new ObjectId(tool.runId) })) as Run | null; } catch {}
  const chain = tool.money ? await chainState().catch(() => null) : null;
  const accent = safeAccent(tool.brand.color);
  const tpl = templateById(tool.template);
  const top = run?.ranking?.top[0];

  const answered = events.filter(e => !e.handoff).length;
  const refunds = events.filter(e => e.refund).map(e => ({ ts: e.ts, ...e.refund! }));
  const byDay = new Map<string, { answered: number; handoff: number }>();
  for (const e of events) {
    const k = new Date(e.ts).toISOString().slice(0, 10);
    const v = byDay.get(k) ?? { answered: 0, handoff: 0 };
    if (e.handoff) v.handoff++; else v.answered++;
    byDay.set(k, v);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([day, v]) => ({ day, ...v }));
  const minutesSaved = answered * 4;             // a question by phone or email is about four minutes; stated on the page

  return (
    <main className="mx-auto max-w-2xl px-6 pt-16 pb-32" style={{ ["--accent" as string]: accent }}>
      <p className="text-muted">{tool.company} · {tpl?.name}</p>
      <h1 className="display mt-3 text-[clamp(32px,5.6vw,52px)] font-semibold leading-[1.05]">{tool.name} is live.</h1>
      <p className="mt-4 max-w-md text-muted">
        Customers reach it at <Link href={`/t/${slug}`} className="text-ink underline">/t/{slug}</Link>. Everything it does is logged here, including what it couldn't do.
      </p>

      {tool.selfTest && (
        <section className="mt-12 border-t border-line pt-8">
          <h2 className="display text-[22px] font-medium">Self-test: answered {tool.selfTest.passed} of {tool.selfTest.asked} questions the site can answer</h2>
          <ul className="mt-4 space-y-3">
            {tool.selfTest.items.map((it, i) => (
              <li key={i} className="text-[15px]">
                <p className="font-medium">{it.q} <span className={it.ok ? "text-green" : "text-red"}>{it.ok ? "✓" : "✗"}</span></p>
                <p className="text-muted">{it.reply}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="display text-[22px] font-medium">
          {events.length === 0 ? "Nothing yet — open the tool and ask it something." : `Handled ${answered} of ${events.length} questions without a person`}
        </h2>
        {days.length > 0 && <div className="mt-5"><Handled days={days} accent={accent} /></div>}
        {events.length > 0 && <p className="mt-2 text-sm text-muted">About {minutesSaved} minutes not spent on the phone, at four minutes a question.</p>}
      </section>

      {tool.money && (
        <section className="mt-12 border-t border-line pt-8">
          <h2 className="display text-[22px] font-medium">Refunds</h2>
          {chain && (
            <p className="mt-2 text-muted">
              The tool can still spend <span className="display text-2xl font-semibold tabular-nums text-ink">{chain.allowance}</span> {chain.token}, enforced on chain.
              {run && <> <Link href={`/build/${tool.runId}`} className="underline">Change it</Link>.</>}
            </p>
          )}
          {refunds.length === 0 ? <p className="mt-3 text-muted">None issued yet.</p> : (
            <ol className="mt-4 divide-y divide-line">
              {refunds.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-[15px]">
                  <span className={`w-20 font-semibold ${r.landed ? "text-green" : "text-red"}`}>{r.landed ? "Settled" : "Refused"}</span>
                  <span className="tnum">{r.amount} to {r.to}</span>
                  <span className="text-muted">{new Date(r.ts).toLocaleString()}</span>
                  {r.url ? <a href={r.url} target="_blank" rel="noopener" className="text-sm underline">explorer</a> : <span className="text-sm text-muted">local chain</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {top && (
        <section className="mt-12 border-t border-line pt-8">
          <h2 className="display text-[22px] font-medium">What we said it would do</h2>
          <p className="mt-1 text-sm text-muted">{top.addresses}</p>
          <div className="mt-4 max-w-md"><BeforeAfter hoursNow={top.hoursNow} hoursAfter={top.hoursAfter} assumption={top.assumption} accent={accent} /></div>
        </section>
      )}
    </main>
  );
}
