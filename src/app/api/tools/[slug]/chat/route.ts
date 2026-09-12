import { NextResponse } from "next/server";
import { z } from "zod";
import { conversations, newId, now, tools } from "@/lib/db";
import { answerChat, answerForm } from "@/lib/runtime/chat";
import type { ConversationDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ message: z.string().min(1).max(4000), conversationId: z.string().optional() });

// Simple per-tool rate limit (per server instance).
const buckets = new Map<string, { n: number; reset: number }>();
function limited(slug: string): boolean {
  const b = buckets.get(slug);
  const t = Date.now();
  if (!b || b.reset < t) {
    buckets.set(slug, { n: 1, reset: t + 60_000 });
    return false;
  }
  b.n += 1;
  return b.n > 60;
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (limited(slug)) return NextResponse.json({ error: "Too many messages, try again in a minute" }, { status: 429 });
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Message is required" }, { status: 400 });
  const tool = await (await tools()).findOne({ _id: slug });
  if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });

  if (tool.mode === "form") {
    const reply = await answerForm(tool, body.data.message);
    return NextResponse.json({ reply });
  }

  const convCol = await conversations();
  let conv = body.data.conversationId ? await convCol.findOne({ _id: body.data.conversationId, toolId: slug }) : null;
  if (!conv) {
    conv = { _id: newId(), toolId: slug, messages: [], createdAt: now(), updatedAt: now() } satisfies ConversationDoc;
    await convCol.insertOne(conv);
  }
  const reply = await answerChat(tool, conv.messages, body.data.message);
  const t = now();
  const next = [...conv.messages, { role: "user" as const, content: body.data.message, t }, { role: "assistant" as const, content: reply, t }];
  await convCol.updateOne({ _id: conv._id }, { $set: { messages: next, updatedAt: t } });
  return NextResponse.json({ reply, conversationId: conv._id });
}
