import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const KINDS = new Set(["demo", "consult"]);

/** Stores a demo or consultation request from the landing page in the `leads` collection. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, max = 500) => String(body[k] ?? "").trim().slice(0, max);
  const kind = str("kind");
  const name = str("name", 120);
  const email = str("email", 200);
  if (!KINDS.has(kind)) return NextResponse.json({ error: "Unknown request type." }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Please tell us your name." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That email address does not look right." }, { status: 400 });
  const doc = {
    kind: kind as "demo" | "consult",
    name,
    email,
    company: str("company", 200),
    website: str("website", 300),
    message: str("message", 2000),
    preferredTime: str("preferredTime", 200),
    createdAt: new Date(),
  };
  try {
    const r = await (await db()).collection("leads").insertOne(doc);
    return NextResponse.json({ ok: true, id: String(r.insertedId) });
  } catch (e) {
    // The request still counts: log it so nobody is lost when the database is down.
    console.warn("[tailor] could not store lead, logging instead:", (e as Error).message, JSON.stringify(doc));
    return NextResponse.json({ ok: true });
  }
}
