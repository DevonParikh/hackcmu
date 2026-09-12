import { NextResponse } from "next/server";
import { hasAccessFromRequest } from "@/lib/access";
import { withApi } from "@/lib/api";
import { newId, now, runs, sources } from "@/lib/db";
import { extractDocumentText } from "@/lib/ingest/documents";
import { IntakeSchema, type SourceDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 10;

/**
 * Saves what the owner knows: files (with an audience tag), their most-asked questions,
 * and a few plain numbers. Multipart form data. Never re-crawls; the report recomputes.
 */
export const POST = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  if (!hasAccessFromRequest(req)) return NextResponse.json({ error: "Access key required." }, { status: 401 });
  const { id } = await ctx.params;
  const runCol = await runs();
  const run = await runCol.findOne({ _id: id });
  if (!run) return NextResponse.json({ error: "We couldn't find that analysis." }, { status: 404 });
  const fd = await req.formData();
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const num = (k: string) => (str(k) === "" ? undefined : Number(str(k)));
  const opt = (k: string) => (str(k) === "" ? undefined : str(k));
  const parsed = IntakeSchema.safeParse({
    inquiriesPerWeek: num("inquiriesPerWeek"),
    routineShare: opt("routineShare"),
    minutesPerInquiry: opt("minutesPerInquiry"),
    replyTime: opt("replyTime"),
    hourValue: num("hourValue"),
    itemsPerMonth: num("itemsPerMonth"),
    topQuestions: str("topQuestions").split(/\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5),
  });
  if (!parsed.success) return NextResponse.json({ error: "Please use whole numbers in the number fields." }, { status: 400 });

  const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  const audiences = fd.getAll("audience").map(String);
  if (files.length > MAX_FILES) return NextResponse.json({ error: `Upload at most ${MAX_FILES} files at a time.` }, { status: 400 });
  const docs: SourceDoc[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const d = await extractDocumentText(files[i]);
      docs.push({
        _id: newId(),
        runId: id,
        companyId: run.companyId,
        url: "user-upload:" + d.title,
        kind: "user",
        audience: audiences[i] === "staff" ? "staff" : "public",
        title: d.title,
        text: d.text,
        description: "",
        fetchedAt: now(),
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  const notes = str("notes");
  if (notes) {
    docs.push({ _id: newId(), runId: id, companyId: run.companyId, url: "user-upload:Notes you added", kind: "user", audience: "public", title: "Notes you added", text: notes.slice(0, 100_000), description: "", fetchedAt: now() });
  }
  const srcCol = await sources();
  if (docs.length) {
    // Replace earlier uploads with the same title so re-uploading a corrected file works.
    await srcCol.deleteMany({ runId: id, kind: "user", title: { $in: docs.map((d) => d.title) } });
    await srcCol.insertMany(docs);
  }
  await runCol.updateOne({ _id: id }, { $set: { intake: parsed.data, updatedAt: now() } });
  return NextResponse.json({ ok: true, documents: docs.length, intake: parsed.data });
});
