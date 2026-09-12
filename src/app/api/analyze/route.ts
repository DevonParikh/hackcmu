import { NextResponse, after } from "next/server";
import { hasAccessFromRequest } from "@/lib/access";
import { withApi } from "@/lib/api";
import { companies, newId, now, runs, sources } from "@/lib/db";
import { normalizeUrl } from "@/lib/ingest/crawl";
import { extractDocumentText } from "@/lib/ingest/documents";
import { isDemo } from "@/lib/llm";
import { executeRun } from "@/lib/pipeline/run";
import { AnalyzeInputSchema, type CompanyDoc, type RunDoc, type SourceDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILES = 10;

/** Accepts JSON, or multipart form data with the same fields plus "files" and "notes". */
async function readInput(req: Request): Promise<{ raw: Record<string, unknown>; files: File[] }> {
  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const fd = await req.formData();
    const str = (k: string) => String(fd.get(k) ?? "");
    const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
    return {
      raw: {
        url: str("url"),
        name: str("name"),
        pain: str("pain"),
        notes: str("notes"),
        competitors: str("competitors").split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
      },
      files,
    };
  }
  return { raw: (await req.json().catch(() => ({}))) as Record<string, unknown>, files: [] };
}

export const POST = withApi(async (req: Request) => {
  if (!hasAccessFromRequest(req)) return NextResponse.json({ error: "Access key required." }, { status: 401 });
  const { raw, files } = await readInput(req);
  const body = AnalyzeInputSchema.safeParse(raw);
  if (!body.success) return NextResponse.json({ error: "Enter a website URL to get started." }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `Upload at most ${MAX_FILES} files.` }, { status: 400 });
  let url: string;
  try {
    url = normalizeUrl(body.data.url);
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error("bad protocol");
  } catch {
    return NextResponse.json({ error: "That doesn't look like a website address. Try something like example.com." }, { status: 400 });
  }

  // Extract text from uploaded documents before anything is stored, so a bad file fails fast.
  const docs: { title: string; text: string }[] = [];
  for (const f of files) {
    try {
      docs.push(await extractDocumentText(f));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  if (body.data.notes.trim()) docs.push({ title: "Notes you added", text: body.data.notes.trim().slice(0, 100_000) });

  const host = new URL(url).host;
  const t = now();
  const compCol = await companies();
  const fresh: CompanyDoc = {
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
  // One document per host, even when two analyses start at the same moment.
  const company = (await compCol.findOneAndUpdate({ host }, { $setOnInsert: fresh }, { upsert: true, returnDocument: "after" })) ?? (await compCol.findOne({ host }));
  if (!company) return NextResponse.json({ error: "Could not save the business record. Please try again." }, { status: 500 });
  const run: RunDoc = {
    _id: newId(),
    companyId: company._id,
    url,
    input: { ...body.data, notes: "", competitors: body.data.competitors.map((c) => c.trim()).filter(Boolean) },
    intake: { topQuestions: [] },
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
  if (docs.length) {
    const userSources: SourceDoc[] = docs.map((d) => ({
      _id: newId(),
      runId: run._id,
      companyId: company._id,
      url: "user-upload:" + d.title,
      kind: "user",
      audience: "public",
      title: d.title,
      text: d.text,
      description: "",
      fetchedAt: t,
    }));
    await (await sources()).insertMany(userSources);
  }
  after(() => executeRun(run._id));
  return NextResponse.json({ runId: run._id, companyId: company._id, documents: docs.length });
});
