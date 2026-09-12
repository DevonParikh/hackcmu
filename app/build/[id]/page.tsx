// Screen 3 — the plan. Name it, set the tone, set what's off-limits, set the refund allowance ON CHAIN, build.
import { ObjectId } from "mongodb";
import Link from "next/link";
import { db } from "@/lib/db";
import { templateById, TEMPLATES, type Run } from "@/lib/schemas";
import { safeAccent } from "@/lib/brand";
import BuildForm from "@/components/BuildForm";
import BeforeAfter from "@/components/charts/BeforeAfter";

export const dynamic = "force-dynamic";

export default async function Build({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run: Run | null = null;
  try { run = (await (await db()).collection("runs").findOne({ _id: new ObjectId(id) })) as Run | null; } catch {}
  if (!run || run.stage !== "ranked" || !run.ranking) return (
    <main className="mx-auto max-w-2xl px-6 py-24"><p>That analysis isn't finished.</p><Link href="/" className="underline">Start over</Link></main>
  );
  const top = run.ranking.top[0];
  const tpl = templateById(top.template)!;
  const accent = safeAccent(run.brand?.colors?.[0]);
  const company = run.profile?.name || run.name || "the company";

  return (
    <main className="mx-auto max-w-2xl px-6 pt-16 pb-32" style={{ ["--accent" as string]: accent }}>
      <p className="text-muted"><Link href={`/report/${id}`} className="hover:underline">← Report</Link> · {company}</p>
      <h1 className="display mt-3 text-[clamp(32px,5.6vw,52px)] font-semibold leading-[1.05]">Build {tpl.name.toLowerCase()} for {company}.</h1>
      <p className="mt-4 max-w-md text-muted">{top.why}</p>

      <div className="mt-8 max-w-md">
        <BeforeAfter hoursNow={top.hoursNow} hoursAfter={top.hoursAfter} assumption={top.assumption} accent={accent} />
      </div>

      <BuildForm
        runId={id}
        company={company}
        templates={TEMPLATES.map(t => ({ id: t.id, name: t.name, money: t.money }))}
        defaultTemplate={tpl.id}
        defaultName={`${company} assistant`}
        defaultTone={/warm|friendly|casual/i.test(run.profile?.tone ?? "") ? "warm" : /formal|professional/i.test(run.profile?.tone ?? "") ? "formal" : "warm"}
        accent={accent}
      />
    </main>
  );
}
