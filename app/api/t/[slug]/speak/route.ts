// POST /api/t/[slug]/speak { text } → audio/mpeg from ElevenLabs, or 204 so the browser voice takes over.
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { text } = await req.json().catch(() => ({}));
  const key = process.env.ELEVENLABS_API_KEY;
  const t = String(text ?? "").slice(0, 600);
  if (!key || !t) return new Response(null, { status: 204 });
  const voice = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  const model = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: t, model_id: model }),
    });
    if (!r.ok) return new Response(null, { status: 204 });
    return new Response(await r.arrayBuffer(), { headers: { "content-type": "audio/mpeg" } });
  } catch { return new Response(null, { status: 204 }); }
}
