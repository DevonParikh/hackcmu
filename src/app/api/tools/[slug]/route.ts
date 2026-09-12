import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { tools } from "@/lib/db";
import { publicTool } from "@/lib/publicTool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const tool = await (await tools()).findOne({ _id: slug });
  if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
  return NextResponse.json(publicTool(tool), { headers: { "access-control-allow-origin": "*" } });
});
