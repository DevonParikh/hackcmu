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
  if (!(req.headers.get("content-type") || "").includes("multipart/form-data")) return NextResponse.json({ error: "Send the form as multipart form data." }, { status: 400 });
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
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = String(issue?.path?.[0] ?? "");
    const msg = path === "topQuestions" ? "Keep each question under 300 characters, five questions at most." : /number/i.test(issue?.message ?? "") || /PerWeek|Value|PerMonth/.test(path) ? "Please use whole numbers in the number fields." : "One of the choices was not recognised. Please pick from the lists.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Pair every file with its audience tag BEFORE dropping empty files, so tags never shift.
  const audiences = fd.getAll("audience").map(String);
  const uploads = fd
    .getAll("files")
    .map((f, i) => ({ file: f as File, audience: audiences[i] === "staff" ? ("staff" as const) : ("public" as const) }))
    .filter((u) => typeof u.file === "object" && u.file !== null && "arrayBuffer" in u.file && u.file.size > 0);
  if (uploads.length > MAX_FILES) return NextResponse.json({ error: `Upload at most ${MAX_FILES} files at a time.` }, { status: 400 });
  const docs: SourceDoc[] = [];
  for (const u of uploads) {
    try {
      const d = await extractDocumentText(u.file);
      docs.push({
        _id: newId(),
        runId: id,
        companyId: run.companyId,
        url: "user-upload:" + d.title,
        kind: "user",
        audience: u.audience,
        title: d.title,
        text: d.text,
        description: "",
        fetchedAt: now(),
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  const srcCol = await sources();
  const notes = str("notes");
  if (notes) {
    // Notes accumulate; a second note must not erase the first.
    const existing = await srcCol.findOne({ runId: id, kind: "user", title: "Notes you added" });
    const text = [existing?.text, notes].filter(Boolean).join("\n\n").slice(0, 100_000);
    docs.push({ _id: existing?._id ?? newId(), runId: id, companyId: run.companyId, url: "user-upload:Notes you added", kind: "user", audience: "public", title: "Notes you added", text, description: "", fetchedAt: now() });
  }
  if (docs.length) {
    // Re-uploading a file with the same name replaces the earlier copy.
    await srcCol.deleteMany({ runId: id, kind: "user", title: { $in: docs.map((d) => d.title) } });
    await srcCol.insertMany(docs);
  }
  await runCol.updateOne({ _id: id }, { $set: { intake: parsed.data, updatedAt: now() } });
  return NextResponse.json({ ok: true, documents: docs.length, intake: parsed.data });
});
