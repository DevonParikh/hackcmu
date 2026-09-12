// POST /api/analyze  { url }  →  text/event-stream
//   event: run   { id }        first, so the client knows where the report will be
//   event: log   { m }         one per progress line
//   event: done  { id }        navigate to /report/{id}
//   event: error { m }

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { runAnalysis } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = String(body?.url ?? "").trim();
  let start: URL;
  try { start = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { return Response.json({ error: "That doesn't look like a website address." }, { status: 400 }); }

  const runs = (await db()).collection("runs");
  const { insertedId } = await runs.insertOne({ url: start.href, stage: "started", createdAt: new Date() });

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
          e => send("estimate", e));
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
