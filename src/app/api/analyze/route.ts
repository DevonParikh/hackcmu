import { NextResponse, after } from "next/server";
import { companies, newId, now, runs } from "@/lib/db";
import { normalizeUrl } from "@/lib/ingest/crawl";
import { isDemo } from "@/lib/llm";
import { executeRun } from "@/lib/pipeline/run";
import { AnalyzeInputSchema, type CompanyDoc, type RunDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = AnalyzeInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Enter a website URL" }, { status: 400 });
  let url: string;
  try {
    url = normalizeUrl(body.data.url);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL" }, { status: 400 });
  }
  const host = new URL(url).host;
  const t = now();
  const compCol = await companies();
  let company = await compCol.findOne({ host });
  if (!company) {
    const doc: CompanyDoc = {
      _id: newId(),
      host,
      url,
      name: body.data.name || host,
      profile: null,
      features: null,
      tech: [],
      brand: { primary: "#0e6b60", secondary: "#b9791e", logoUrl: null },
      contact: { email: null, phone: null, address: null },
      pageCount: 0,
      lastRunId: null,
      createdAt: t,
      updatedAt: t,
    };
    await compCol.insertOne(doc);
    company = doc;
  }
  const run: RunDoc = {
    _id: newId(),
    companyId: company._id,
    url,
    input: { ...body.data, competitors: body.data.competitors.map((c) => c.trim()).filter(Boolean) },
    mode: isDemo() ? "demo" : "live",
    status: "queued",
    stage: "queued",
    log: [],
    competitors: [],
    assessment: null,
    opportunities: [],
    toolIds: [],
    error: null,
    createdAt: t,
    updatedAt: t,
  };
  await (await runs()).insertOne(run);
  after(() => executeRun(run._id));
  return NextResponse.json({ runId: run._id, companyId: company._id });
}
