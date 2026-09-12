// GET  /api/allowance            → the on-chain state (balance, the agent's allowance)
// POST /api/allowance { amount } → the OWNER re-grants the allowance (needs owner.json on this machine)
import { NextRequest } from "next/server";
import { chainState, setAllowance } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await chainState();
    return s ? Response.json(s) : Response.json({ error: "Refunds aren't configured on this machine." }, { status: 503 });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const { amount } = await req.json().catch(() => ({}));
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return Response.json({ error: "Give an amount between 0 and 1,000,000." }, { status: 400 });
  try { return Response.json(await setAllowance(n)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
