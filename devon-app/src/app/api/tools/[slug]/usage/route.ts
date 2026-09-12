import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { conversations, tools } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Counts only. Message text never leaves the server. */
export const GET = withApi(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const tool = await (await tools()).findOne({ _id: slug });
  if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
  const convs = await (await conversations()).find({ toolId: slug }).toArray();
  let replies = 0, answered = 0, handedOff = 0, questionsAnswered = 0;
  const perDay = new Map<string, { answered: number; handedOff: number }>();
  for (const c of convs) {
    for (const m of c.messages) {
      if (m.role !== "assistant") continue;
      replies++;
      // Prompts for the next intake detail are not answered questions.
      if (m.outcome !== "handed_off" && !/could you share|i have what i need/i.test(m.content)) questionsAnswered++;
      const day = m.t.slice(0, 10);
      const d = perDay.get(day) ?? { answered: 0, handedOff: 0 };
      if (m.outcome === "handed_off") {
        handedOff++;
        d.handedOff++;
      } else {
        answered++;
        d.answered++;
      }
      perDay.set(day, d);
    }
  }
  return NextResponse.json({
    conversations: convs.filter((c) => c.messages.some((m) => m.role === "user")).length,
    replies,
    answered,
    handedOff,
    questionsAnswered,
    mode: tool.mode,
    perDay: [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v })),
  });
});
