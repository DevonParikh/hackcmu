import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessRequired } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Sets the access cookie when the key matches. */
export async function POST(req: Request) {
  if (!accessRequired()) return NextResponse.json({ ok: true });
  const body = (await req.json().catch(() => ({}))) as { key?: string };
  if (!body.key || body.key !== process.env.TAILOR_ACCESS_KEY) return NextResponse.json({ error: "That key is not right." }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, body.key, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
