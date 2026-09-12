import { NextResponse } from "next/server";
import { hasAccessFromRequest } from "@/lib/access";
import { withApi } from "@/lib/api";
import { companies, runs, sources, tools } from "@/lib/db";
import { computeImpact } from "@/lib/pipeline/impact";
import { companyForRun } from "@/lib/runCompany";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 10 * 60 * 1000;

export const GET = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  if (!hasAccessFromRequest(req)) return NextResponse.json({ error: "Access key required." }, { status: 401 });
  const { id } = await ctx.params;
  const runCol = await runs();
  let run = await runCol.findOne({ _id: id });
  if (!run) return NextResponse.json({ error: "We couldn't find that analysis. It may have been removed." }, { status: 404 });
  if ((run.status === "running" || run.status === "queued") && Date.now() - Date.parse(run.updatedAt) > STALE_MS) {
    const error = "The analysis stopped unexpectedly (the server may have restarted). Please run it again.";
    await runCol.updateOne({ _id: id }, { $set: { status: "failed", stage: "failed", error, updatedAt: new Date().toISOString() } });
    run = { ...run, status: "failed", stage: "failed", error };
  }
  const company = companyForRun(run, await (await companies()).findOne({ _id: run.companyId }));
  const built = await (await tools()).find({ runId: id }).sort({ createdAt: -1 }).toArray();
  const srcs = await (await sources()).find({ runId: id }).toArray();
  const impact = company && run.status === "done" ? computeImpact({ run, company, sources: srcs, tools: built }) : null;
  return NextResponse.json({
    run,
    company,
    impact,
    sources: srcs.map((s) => ({ id: s._id, title: s.title, url: s.url, kind: s.kind, audience: s.audience ?? null, chars: s.text.length })),
    tools: built.map((t) => ({ ...t, config: { ...t.config, knowledge: undefined, systemPrompt: undefined }, knowledgeCount: t.config.knowledge.length })),
  });
});
