// POST /api/t/[slug]/chat { messages, wallet? } → { reply, handoff, refund, refundError, provider }
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { toolTurn } from "@/lib/tools";
import type { Tool } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const tool = await (await db()).collection<Tool>("tools").findOne({ slug });
  if (!tool) return Response.json({ error: "No such tool." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages)
    ? body.messages.filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string").map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
    : [];
  if (!messages.length || messages.at(-1).role !== "user") return Response.json({ error: "Say something first." }, { status: 400 });
  try { return Response.json(await toolTurn(tool, messages, typeof body.wallet === "string" && body.wallet.trim() ? body.wallet.trim() : undefined)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
