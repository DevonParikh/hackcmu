// POST /api/check { id }  →  re-runs the deterministic checks on a stored run (no re-scrape, no LLM) and saves the result.
// Useful after tuning the checks, or to re-verify a demo run in front of someone.

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { verifyAssessment } from "@/lib/verify";
import type { Run } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  let _id: ObjectId;
  try { _id = new ObjectId(String(id)); } catch { return Response.json({ error: "bad id" }, { status: 400 }); }
  const runs = (await db()).collection("runs");
  const run = (await runs.findOne({ _id })) as Run | null;
  if (!run?.assessment || !run.sources) return Response.json({ error: "no assessment on that run" }, { status: 404 });
  const { assessment, report } = verifyAssessment(run.assessment, run.sources);
  await runs.updateOne({ _id }, { $set: { assessment, verification: report, updatedAt: new Date() } });
  return Response.json({ report, signals: assessment.frictionSignals.length });
}
