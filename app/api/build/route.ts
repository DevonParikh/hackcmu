// POST /api/build { runId, name, tone, offLimits, template?, wallet? } → { slug }
// TODO(auth0): this and /api/allowance are owner actions; gate them on the owner's session.
import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { buildTool } from "@/lib/tools";
import type { Run } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let _id: ObjectId;
  try { _id = new ObjectId(String(body.runId)); } catch { return Response.json({ error: "bad run id" }, { status: 400 }); }
  const run = (await (await db()).collection("runs").findOne({ _id })) as Run | null;
  if (!run || run.stage !== "ranked") return Response.json({ error: "That analysis isn't finished." }, { status: 404 });
  try {
    const tool = await buildTool(run, {
      name: String(body.name ?? ""), tone: String(body.tone ?? "warm"),
      offLimits: String(body.offLimits ?? "").split(/[,\n;]/), template: body.template, wallet: body.wallet,
    });
    return Response.json({ slug: tool.slug, selfTest: tool.selfTest ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
