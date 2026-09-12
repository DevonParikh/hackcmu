// POST /api/analyze  →  text/event-stream
//   Body: JSON { url } or multipart form-data with url, name, competitors, pain, notes, files[] (PDF, text, Markdown, CSV, HTML).
//   event: run   { id }        first, so the client knows where the report will be
//   event: log   { m }         one per progress line
//   event: done  { id }        navigate to /report/{id}
//   event: error { m }

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { competitorUrls, documentSource, notesSource } from "@/lib/documents";
import { runAnalysis, type AnalysisInput } from "@/lib/pipeline";
import type { Source } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILES = 8;

export async function POST(req: NextRequest) {
  // The start page sends multipart (it may carry files); older clients and scripts send JSON.
  let fields: Record<string, string> = {};
  let files: File[] = [];
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const fd = await req.formData().catch(() => null);
    if (!fd) return Response.json({ error: "Could not read the form." }, { status: 400 });
    for (const [k, v] of fd.entries()) {
      if (v instanceof File) { if (v.size > 0 && files.length < MAX_FILES) files.push(v); }
      else fields[k] = String(v);
    }
  } else {
    const body = await req.json().catch(() => ({}));
    fields = Object.fromEntries(Object.entries(body ?? {}).map(([k, v]) => [k, String(v ?? "")]));
  }

  const raw = (fields.url ?? "").trim();
  let start: URL;
  try { start = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { return Response.json({ error: "That doesn't look like a website address." }, { status: 400 }); }

  // Read uploads before the stream opens so a bad file is a normal error, not a stopped run.
  const documents: Source[] = [];
  try {
    for (const f of files) documents.push(await documentSource(f));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not read one of the files." }, { status: 400 });
  }
  const notes = notesSource(fields.notes ?? "");
  if (notes) documents.push(notes);

  const input: AnalysisInput = {
    name: (fields.name ?? "").trim().slice(0, 120),
    pain: (fields.pain ?? "").trim().slice(0, 600),
    documents,
    competitors: competitorUrls(fields.competitors ?? ""),
  };

  const runs = (await db()).collection("runs");
  const { insertedId } = await runs.insertOne({ url: start.href, stage: "started", createdAt: new Date(), ...(input.name ? { name: input.name } : {}) });

  const enc = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    async start(ctrl) {
      // The client navigates to the report on "done" while the benchmark stage is still running,
      // so every send tolerates a closed stream.
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try { ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { open = false; }
      };
      send("run", { id: insertedId.toString() });
      try {
        await runAnalysis(insertedId, start.href, m => send("log", { m }),
          () => send("done", { id: insertedId.toString() }),
          e => send("estimate", e),
          input);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        await runs.updateOne({ _id: insertedId }, { $set: { stage: "failed", error: m } });
        send("error", { m });
      } finally {
        if (open) { try { ctrl.close(); } catch {} }
        open = false;
      }
    },
    cancel() { open = false; },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
