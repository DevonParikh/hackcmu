import { NextResponse } from "next/server";
import { hasAccessFromRequest } from "@/lib/access";
import { withApi } from "@/lib/api";
import { companies } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req: Request) => {
  if (!hasAccessFromRequest(req)) return NextResponse.json({ error: "Access key required." }, { status: 401 });
  const list = await (await companies()).find({}).sort({ updatedAt: -1 }).limit(20).toArray();
  return NextResponse.json({
    companies: list.map((c) => ({ id: c._id, name: c.name, url: c.url, host: c.host, pageCount: c.pageCount, lastRunId: c.lastRunId, updatedAt: c.updatedAt, tagline: c.profile?.tagline ?? "" })),
  });
});
