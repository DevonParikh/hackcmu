// server.mjs — HTTP front end over core.mjs. Serves public/ and a small JSON API.
//
//   node server.mjs            → http://localhost:3000
//
// Optional .env:
//   ELEVENLABS_API_KEY=...       read-back is spoken by ElevenLabs. Without it: the browser's voice.
//   ELEVENLABS_VOICE_ID=...      default 21m00Tcm4TlvDq8ikWAM
//   ELEVENLABS_MODEL=...         default eleven_flash_v2_5
//   PORT=3000
//
// Chain webhook: WEBHOOK_SECRET=...   (POST /api/webhook, Authorization: <secret>; Helius transaction webhooks fit as-is)
// Login (Auth0), on when all three are set — without them the page is open, which is fine on a laptop:
//   AUTH0_ISSUER_BASE_URL=https://<tenant>.us.auth0.com   AUTH0_CLIENT_ID=...   AUTH0_SECRET=<32+ random chars>
//   AUTH0_BASE_URL=https://agent.example.com               (this server's public URL; defaults to http://localhost:PORT)
//   DELEGATES=alice@x.com=keys/agent.json,bob@x.com=keys/agent-bob.json
// With login on: /api/intent, /api/confirm and /api/decline need a session; the login's email picks the delegate
// keypair from DELEGATES (else the default AGENT_KEYPAIR); and every audit row records who asked.

import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { auth } from "express-openid-connect";

let core;
try { core = await import("../money/core.mjs"); }
catch (e) { console.error(`\n  ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`); process.exit(1); }
const { prepare, execute, audit, readLog, getState, loadDelegate, recordChainEvent, TOKEN, CLUSTER, RPC, oneLine } = core;

const PORT = process.env.PORT ?? 3000;
const app = express();
app.use(express.json());

// ---------------------------------------------------------------- who is talking to the agent (Auth0)
const AUTH0 = ["AUTH0_ISSUER_BASE_URL", "AUTH0_CLIENT_ID", "AUTH0_SECRET"].every(k => process.env[k]);
if (AUTH0) app.use(auth({
  authRequired: false, auth0Logout: true,
  secret: process.env.AUTH0_SECRET, clientID: process.env.AUTH0_CLIENT_ID, issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  baseURL: process.env.AUTH0_BASE_URL ?? `http://localhost:${PORT}`,
}));
const user = req => (AUTH0 && req.oidc?.isAuthenticated() ? req.oidc.user : null);
const who  = req => user(req)?.email ?? user(req)?.sub ?? null;
const gate = (req, res, next) => (!AUTH0 || user(req) ? next() : res.status(401).json({ error: "Sign in first.", login: "/login" }));

// login → delegate keypair. One token account has one approved delegate, so most logins share the default key;
// the map is for a second owner/agent pair. The chain, not this table, decides whether a key may spend.
const DELEGATES = Object.fromEntries((process.env.DELEGATES ?? "").split(",").map(s => s.trim()).filter(Boolean)
  .map(s => s.split("=").map(x => x.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k.toLowerCase(), v]));
const keyCache = new Map();
function delegateFor(req) {
  const p = DELEGATES[String(who(req) ?? "").toLowerCase()];
  if (!p) return undefined;
  if (!keyCache.has(p)) keyCache.set(p, loadDelegate(p));
  return keyCache.get(p);
}

app.get("/api/me", (req, res) => {
  const u = user(req);
  res.json({ auth: AUTH0, user: u ? { email: u.email ?? null, name: u.name ?? null } : null, login: "/login", logout: "/logout",
             delegate: delegateFor(req) ? "mapped" : "default" });
});
app.use((req, res, next) => {                       // permissive CORS: page on localhost, API anywhere
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));

const pending = new Map();                          // id → prepared intent, awaiting a human

app.get("/api/state", async (req, res) => {
  try { res.json({ token: TOKEN, ...(await getState({ agent: delegateFor(req) })) }); }
  catch (e) { res.status(500).json({ error: oneLine(e) }); }
});

// Parse, resolve, simulate. Nothing is sent. Returns the read-back and a pending id.
app.post("/api/intent", gate, async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "Say or type what you want to send." });
  const agent = delegateFor(req);
  try {
    const p  = await prepare(text, { agent });
    const id = randomUUID();
    pending.set(id, { p, agent, who: who(req) });
    setTimeout(() => pending.delete(id), 10 * 60 * 1000);
    const { rawStr, ...view } = p;
    res.json({ id, token: TOKEN, ...view });
  } catch (e) {
    const error = oneLine(e);
    await audit({ input: text, who: who(req), error });
    res.status(422).json({ error });
  }
});

// The human said yes. Send it and let the chain decide.
app.post("/api/confirm", gate, async (req, res) => {
  const entry = pending.get(req.body?.id);
  if (!entry) return res.status(404).json({ error: "Nothing is waiting to be sent. Ask again." });
  pending.delete(req.body.id);
  const { p, agent } = entry;
  const record = { input: p.input, who: who(req), agent: p.agent, intent: p.intent, amount: p.amount, to: p.rcpt.label, simulated: p.simulated,
                   signature: null, landed: false, blocked: false, chainError: null, error: null };
  try { Object.assign(record, await execute(p, { agent })); }
  catch (e) { record.error = oneLine(e); }
  record.loggedTo = await audit(record);
  res.json(record);
});

app.post("/api/decline", gate, async (req, res) => {
  const entry = pending.get(req.body?.id);
  if (entry) {
    pending.delete(req.body.id);
    const { p } = entry;
    await audit({ input: p.input, who: who(req), agent: p.agent, intent: p.intent, amount: p.amount, to: p.rcpt.label,
                  simulated: p.simulated, error: "declined at confirmation" });
  }
  res.json({ ok: true });
});

app.get("/api/log", async (req, res) => {
  try { res.json(await readLog(12)); }
  catch (e) { res.status(500).json({ error: oneLine(e) }); }
});

// The webhook listener: the chain's own word on what happened, out of band. Point a Helius (or any) transaction
// webhook for the delegate address here; set WEBHOOK_SECRET and send it as the Authorization header. Each event is
// stored, and the attempt with that signature is marked confirmedByChain — our client's verdict and the chain's agree.
app.post("/api/webhook", async (req, res) => {
  if (process.env.WEBHOOK_SECRET && req.get("authorization") !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: "bad secret" });
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const out = [];
  for (const ev of events) {
    const signature = ev?.signature ?? ev?.transaction?.signatures?.[0] ?? null;
    if (!signature) continue;
    out.push({ signature, ...(await recordChainEvent({ signature, err: ev?.transactionError ?? ev?.meta?.err ?? null, slot: ev?.slot ?? null, type: ev?.type ?? null, description: ev?.description ?? null })) });
  }
  res.json({ ok: true, recorded: out });
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

// One line, never a stack trace: an unreachable login provider is the usual cause.
app.use((err, req, res, next) => {
  const m = oneLine(err);
  console.error("server:", m);
  res.status(err.status ?? 500).json({ error: /discovery|issuer|openid|ENOTFOUND|fetch failed|unexpected HTTP response/i.test(m) ? `Login provider unreachable (${process.env.AUTH0_ISSUER_BASE_URL}). Check the wifi, or run without AUTH0_* to demo without login.` : m });
});

app.listen(PORT, () => {
  console.log(`agent listening on http://localhost:${PORT}   (${CLUSTER} · ${RPC})`);
  console.log(`login: ${AUTH0 ? `Auth0 ${process.env.AUTH0_ISSUER_BASE_URL}${Object.keys(DELEGATES).length ? `, ${Object.keys(DELEGATES).length} mapped delegate key(s)` : ""}` : "off (set AUTH0_ISSUER_BASE_URL, AUTH0_CLIENT_ID, AUTH0_SECRET to require it)"}`);
  if (CLUSTER === "localnet") console.log("LOCALNET: a private ledger, not a public chain — explorer links are off.");
  console.log(`voice: ${process.env.ELEVENLABS_API_KEY ? "ElevenLabs" : "browser (set ELEVENLABS_API_KEY to upgrade)"}`);
});
