// server.mjs — HTTP front end over core.mjs. Serves public/ and a small JSON API.
//
//   node server.mjs            → http://localhost:3000
//
// Optional .env:
//   ELEVENLABS_API_KEY=...       read-back is spoken by ElevenLabs. Without it: the browser's voice.
//   ELEVENLABS_VOICE_ID=...      default 21m00Tcm4TlvDq8ikWAM
//   ELEVENLABS_MODEL=...         default eleven_flash_v2_5
//   PORT=3000

import express from "express";
import { randomUUID } from "node:crypto";
import { prepare, execute, audit, readLog, getState, TOKEN, oneLine } from "./core.mjs";

const app = express();
app.use(express.json());
app.use((req, res, next) => {                       // permissive CORS: page on localhost, API anywhere
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static("public"));

const pending = new Map();                          // id → prepared intent, awaiting a human

app.get("/api/state", async (req, res) => {
  try { res.json({ token: TOKEN, ...(await getState()) }); }
  catch (e) { res.status(500).json({ error: oneLine(e) }); }
});

// Parse, resolve, simulate. Nothing is sent. Returns the read-back and a pending id.
app.post("/api/intent", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "Say or type what you want to send." });
  try {
    const p  = await prepare(text);
    const id = randomUUID();
    pending.set(id, p);
    setTimeout(() => pending.delete(id), 10 * 60 * 1000);
    const { rawStr, ...view } = p;
    res.json({ id, token: TOKEN, ...view });
  } catch (e) {
    const error = oneLine(e);
    await audit({ input: text, error });
    res.status(422).json({ error });
  }
});

// The human said yes. Send it and let the chain decide.
app.post("/api/confirm", async (req, res) => {
  const p = pending.get(req.body?.id);
  if (!p) return res.status(404).json({ error: "Nothing is waiting to be sent. Ask again." });
  pending.delete(req.body.id);
  const record = { input: p.input, intent: p.intent, amount: p.amount, to: p.rcpt.label, simulated: p.simulated,
                   signature: null, landed: false, blocked: false, chainError: null, error: null };
  try { Object.assign(record, await execute(p)); }
  catch (e) { record.error = oneLine(e); }
  record.loggedTo = await audit(record);
  res.json(record);
});

app.post("/api/decline", async (req, res) => {
  const p = pending.get(req.body?.id);
  if (p) {
    pending.delete(req.body.id);
    await audit({ input: p.input, intent: p.intent, amount: p.amount, to: p.rcpt.label,
                  simulated: p.simulated, error: "declined at confirmation" });
  }
  res.json({ ok: true });
});

app.get("/api/log", async (req, res) => {
  try { res.json(await readLog(12)); }
  catch (e) { res.status(500).json({ error: oneLine(e) }); }
});

// ElevenLabs text-to-speech, proxied so the key stays on the server. 204 = use the browser voice.
app.post("/api/speak", async (req, res) => {
  const text = String(req.body?.text ?? "").slice(0, 500);
  const key  = process.env.ELEVENLABS_API_KEY;
  if (!key || !text) return res.sendStatus(204);
  const voice = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  const model = process.env.ELEVENLABS_MODEL    ?? "eleven_flash_v2_5";
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: model }),
    });
    if (!r.ok) { console.error("ElevenLabs", r.status, (await r.text()).slice(0, 200)); return res.sendStatus(204); }
    res.set("content-type", "audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { console.error("ElevenLabs", oneLine(e)); res.sendStatus(204); }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`agent listening on http://localhost:${PORT}`);
  console.log(`voice: ${process.env.ELEVENLABS_API_KEY ? "ElevenLabs" : "browser (set ELEVENLABS_API_KEY to upgrade)"}`);
});
