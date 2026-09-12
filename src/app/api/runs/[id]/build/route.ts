import { NextResponse } from "next/server";
import { companies, runs, sources, tools } from "@/lib/db";
import { buildTool } from "@/lib/pipeline/build";
import { appendLog, pushToolId } from "@/lib/pipeline/run";
import { BuildInputSchema } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = BuildInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Pick a template" }, { status: 400 });
  const runCol = await runs();
  const run = await runCol.findOne({ _id: id });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "done") return NextResponse.json({ error: "Analysis is not finished yet" }, { status: 409 });
  const company = await (await companies()).findOne({ _id: run.companyId });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const srcs = await (await sources()).find({ runId: id }).toArray();
  try {
    const tool = await buildTool({
      company,
      run,
      sources: srcs,
      templateId: body.data.templateId,
      name: body.data.name,
      tone: body.data.tone,
      offLimits: body.data.offLimits.map((s) => s.trim()).filter(Boolean),
      log: (m) => void appendLog(id, m),
    });
    await (await tools()).insertOne(tool);
    await pushToolId(id, tool._id);
    return NextResponse.json({ tool: { ...tool, config: { ...tool.config, knowledge: undefined, systemPrompt: undefined }, knowledgeCount: tool.config.knowledge.length } });
  } catch (e) {
    const msg = (e as Error).message;
    await appendLog(id, `Build failed: ${msg}`, "error");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
