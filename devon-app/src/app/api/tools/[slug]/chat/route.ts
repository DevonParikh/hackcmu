import { NextResponse } from "next/server";
import { accessRequired, hasAccessFromRequest } from "@/lib/access";
import { withApi } from "@/lib/api";
import { z } from "zod";
import { conversations, newId, now, tools } from "@/lib/db";
import { answerChat, answerForm, isHandOff } from "@/lib/runtime/chat";
import type { ConversationDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ message: z.string().min(1, "Type a message first.").max(4000, "Please keep messages under 4000 characters."), conversationId: z.string().max(100).optional() });

// Per-instance rate limits: one visitor cannot lock a widget for everyone, and one widget has a ceiling.
const buckets = new Map<string, { n: number; reset: number }>();
function hit(key: string, limit: number): boolean {
  const t = Date.now();
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.reset < t) {
    buckets.set(key, { n: 1, reset: t + 60_000 });
    return false;
  }
  b.n += 1;
  return b.n > limit;
}
const MAX_HISTORY = 200;

export const POST = withApi(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Message is required" }, { status: 400 });
  const tool = await (await tools()).findOne({ _id: slug });
  if (!tool) return NextResponse.json({ error: "This assistant is no longer available." }, { status: 404 });
  if (tool.templateId === "staff_assistant" && accessRequired() && !hasAccessFromRequest(req)) return NextResponse.json({ error: "This assistant is for staff; sign in with the access key." }, { status: 401 });
  // The last address in x-forwarded-for was appended by the closest proxy and is the hardest to spoof.
  const forwarded = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = forwarded[forwarded.length - 1] || "local";
  if (hit(`${slug}|${ip}`, 30) || hit(slug, 600)) return NextResponse.json({ error: "Too many messages in a minute. Please wait a moment and try again." }, { status: 429 });

  if (tool.mode === "form") {
    const reply = await answerForm(tool, body.data.message);
    // Count the draft for the usage panel without storing what was pasted (reviews may contain customer names).
    const t = now();
    await (await conversations()).insertOne({ _id: newId(), toolId: slug, messages: [{ role: "user", content: `[${body.data.message.length} characters pasted]`, t }, { role: "assistant", content: reply, t, outcome: "answered" }], createdAt: t, updatedAt: t });
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
  const outcome = isHandOff(tool, reply) ? ("handed_off" as const) : ("answered" as const);
  const next = [...conv.messages, { role: "user" as const, content: body.data.message, t }, { role: "assistant" as const, content: reply, t, outcome }].slice(-MAX_HISTORY);
  await convCol.updateOne({ _id: conv._id }, { $set: { messages: next, updatedAt: t } });
  return NextResponse.json({ reply, conversationId: conv._id });
});
