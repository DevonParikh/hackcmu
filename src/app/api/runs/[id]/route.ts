import { NextResponse } from "next/server";
import { companies, runs, tools } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = await (await runs()).findOne({ _id: id });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const company = await (await companies()).findOne({ _id: run.companyId });
  const built = await (await tools()).find({ runId: id }).toArray();
  return NextResponse.json({
    run,
    company,
    tools: built.map((t) => ({ ...t, config: { ...t.config, knowledge: undefined, systemPrompt: undefined }, knowledgeCount: t.config.knowledge.length })),
  });
}
