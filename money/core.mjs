// core.mjs — the agent's brain. Shared by agent.mjs and demo.mjs (CLI), server.mjs (API + page) and lib/money.ts (Next).
//
// THE RULE: there is no allowance check in this file, and there must never be one.
// The cap is read to DISPLAY it. Nothing gates on it. The chain is the only enforcer.

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import fs from "node:fs";
import "dotenv/config";

export const env      = process.env;
export const RPC      = env.SOLANA_RPC ?? "https://api.devnet.solana.com";
export const CLUSTER  = /mainnet/i.test(RPC) ? "mainnet" : /devnet/i.test(RPC) ? "devnet"
                      : /127\.0\.0\.1|localhost/.test(RPC) ? "localnet" : /testnet/i.test(RPC) ? "testnet" : "custom";
if (CLUSTER === "mainnet") throw new Error("Refusing to run against mainnet. This project is devnet-only; unset SOLANA_RPC.");
export const DECIMALS = Number(env.DECIMALS ?? 6);
export const UNIT     = 10n ** BigInt(DECIMALS);
export const TOKEN    = env.TOKEN_NAME ?? "USDH";

// name → token account. "ravi" comes from floor.mjs; add teammates with CONTACTS="alice=<token account>,bob=<token account>" in .env.
export const CONTACTS = Object.fromEntries([
  ["ravi", env.RAVI_ATA],
  ...(env.CONTACTS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(s => s.split("=").map(x => x.trim().toLowerCase())),
].filter(([n, a]) => n && a));

export const fmt      = raw => (Number(raw) / Number(UNIT)).toString();
// A link only where one exists. On localnet there is no public chain to link to; callers show the signature instead.
export const explorer = sig => (CLUSTER === "devnet" ? `https://explorer.solana.com/tx/${sig}?cluster=devnet` : null);
export const oneLine  = e   => String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 140);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cap   = s  => s ? s[0].toUpperCase() + s.slice(1) : s;

// Fail with a sentence, not a stack trace, when the wallet isn't set up on this machine.
const missing = ["AGENT_KEYPAIR", "MINT", "OWNER_ATA"].filter(k => !env[k]);
if (missing.length) throw new Error(`No wallet set up on this machine (${missing.join(", ")} not in .env). Run \`npm run floor\` first.`);
if (!fs.existsSync(env.AGENT_KEYPAIR)) throw new Error(`Agent keypair not found at ${env.AGENT_KEYPAIR}. Run \`npm run floor\` (it writes keys/ and .env).`);

export const conn = new Connection(RPC, "confirmed");
// A delegate key in solana-cli JSON format. The env agent is the default; a login can map to a different one (server.mjs DELEGATES).
export const loadDelegate = p => {
  if (!fs.existsSync(p)) throw new Error(`Delegate keypair not found at ${p}.`);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, "utf8"))));
};
const agent  = loadDelegate(env.AGENT_KEYPAIR);
const mint   = new PublicKey(env.MINT);
const source = new PublicKey(env.OWNER_ATA);

// ------------------------------------------------------------------ audit log
let mongo = null;
async function attempts() {
  if (!mongo) {
    const { MongoClient } = await import("mongodb");
    mongo = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
    await mongo.connect();
  }
  return mongo.db("hackcmu").collection("attempts");
}

// Never throws. Returns where the record went, or why it didn't. Every attempt is written: settled, refused, declined, failed.
export async function audit(doc) {
  doc.ts = new Date().toISOString();
  doc.cluster = CLUSTER;
  try {
    if (env.MONGODB_URI) {
      await (await attempts()).insertOne(doc);
      return "MongoDB hackcmu.attempts";
    }
    fs.appendFileSync("attempts.jsonl", JSON.stringify(doc) + "\n");
    return "attempts.jsonl";
  } catch (e) {
    // Mongo down: keep the record anyway, and say where it went.
    try { fs.appendFileSync("attempts.jsonl", JSON.stringify({ ...doc, mongoError: oneLine(e) }) + "\n"); return `attempts.jsonl (MongoDB unreachable: ${oneLine(e).slice(0, 60)})`; }
    catch (e2) { return `audit failed: ${oneLine(e2)}`; }
  }
}

// Rows written by earlier versions of the rail kept the amount and recipient only inside `intent` / `rcpt`.
// Lift them so every reader (--log, the demo's audit section, the prototype's list) prints "20 to ravi", never "? to ?".
function normalizeRow(r) {
  if (!r || typeof r !== "object") return r;
  const amount = r.amount ?? r.intent?.amount ?? r.prepared?.amount ?? null;
  const to = r.to ?? r.rcpt?.label ?? r.prepared?.rcpt?.label ?? r.intent?.to ?? r.recipient ?? null;
  return { ...r, amount, to };
}

export async function readLog(n = 10) {
  if (env.MONGODB_URI) {
    try { return (await (await attempts()).find({}, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(n).toArray()).map(normalizeRow); }
    catch { /* Atlas unreachable: fall through to the file, which audit() also wrote to */ }
  }
  if (!fs.existsSync("attempts.jsonl")) return [];
  return fs.readFileSync("attempts.jsonl", "utf8").trim().split("\n")
           .filter(Boolean).map(l => JSON.parse(l)).slice(-n).reverse().map(normalizeRow);
}

// Out-of-band confirmation from the chain itself (a Helius-style transaction webhook, see server.mjs /api/webhook):
// stored as its own record, and the attempt with that signature is marked confirmedByChain. Never throws.
export async function recordChainEvent(ev) {
  const doc = { ...ev, ts: new Date().toISOString(), cluster: CLUSTER, source: "webhook" };
  try {
    if (env.MONGODB_URI) {
      const db = (await attempts()).s.db;
      await db.collection("chain_events").insertOne(doc);
      const r = await db.collection("attempts").updateOne({ signature: ev.signature }, { $set: { confirmedByChain: true, chainEvent: { err: ev.err ?? null, slot: ev.slot ?? null, ts: doc.ts } } });
      return { where: "MongoDB hackcmu.chain_events", matchedAttempt: r.matchedCount > 0 };
    }
    fs.appendFileSync("chain_events.jsonl", JSON.stringify(doc) + "\n");
    let matched = false;
    if (fs.existsSync("attempts.jsonl")) {
      const rows = fs.readFileSync("attempts.jsonl", "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
      for (const r of rows) if (r.signature === ev.signature) { r.confirmedByChain = true; r.chainEvent = { err: ev.err ?? null, slot: ev.slot ?? null, ts: doc.ts }; matched = true; }
      if (matched) fs.writeFileSync("attempts.jsonl", rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    }
    return { where: "chain_events.jsonl", matchedAttempt: matched };
  } catch (e) { return { where: `not recorded: ${oneLine(e)}`, matchedAttempt: false }; }
}

export async function closeAudit() { if (mongo) { await mongo.close(); mongo = null; } }

// ------------------------------------------------------------------ intent
function normalizeAmount(a) {
  if (a == null) return null;
  if (typeof a === "string" && /^(all|everything|every|entire|max)/i.test(a.trim())) return "all";
  const n = Number(a);
  return Number.isFinite(n) ? n : null;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The typed fallback: no model at all. It finds a contact, an address, and an amount — deliberately naive,
// because it is not this parser's job to say no. "send everything" means the whole wallet; the chain answers that.
export function parseTyped(text) {
  const t    = text.toLowerCase();
  const name = Object.keys(CONTACTS).find(n => new RegExp(`\\b${escapeRe(n)}\\b`).test(t));
  const addr = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/)?.[0];
  const all  = /\b(everything|all of it|all (the|of the) (money|funds|balance|tokens)|the (whole|entire) (balance|wallet|amount)|max(imum)?( amount)?)\b/.test(t)
            || /\b(send|pay|transfer|give|move|wire|drain)\s+(it\s+)?all\b/.test(t);
  // the amount is the number after the verb ("send 500"), else after a $ sign, else the first number in the message
  const num  = t.match(/\b(?:send|pay|transfer|give|move|wire|refund)\s+(?:them\s+|him\s+|her\s+|me\s+)?\$?\s*(\d+(?:\.\d+)?)/)?.[1]
            ?? t.match(/\$\s*(\d+(?:\.\d+)?)/)?.[1]
            ?? t.match(/(\d+(?:\.\d+)?)/)?.[1];
  return { to: name ?? addr ?? null, amount: all ? "all" : num != null ? Number(num) : null, parser: "regex" };
}

async function parseWithGemini(text) {
  const model  = env.GEMINI_MODEL ?? "gemini-3.8-flash";
  const prompt =
`You extract payment instructions. Known contacts: ${Object.keys(CONTACTS).join(", ")}.
Return a JSON object with exactly these keys:
  "to": a contact name from the list, or a raw Solana address if the message contains one, or null
  "amount": a number, or the string "all" if the message asks to send everything, or null
Message: ${JSON.stringify(text)}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 120)}`);
  const data = await res.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const out  = JSON.parse(raw.replace(/```json|```/g, "").trim());
  return { to: typeof out.to === "string" ? out.to.trim() : null, amount: normalizeAmount(out.amount), parser: model };
}

// Gemini, retried once; then the regex parser so a 503 can never take the demo down.
export async function parseIntent(text) {
  if (!env.GEMINI_API_KEY) return parseTyped(text);
  let last;
  for (let i = 0; i < 2; i++) {
    try { return await parseWithGemini(text); }
    catch (e) { last = e; if (i === 0) await sleep(1200); }
  }
  const d = parseTyped(text);
  d.parser = "regex (fallback)";
  d.note   = `Gemini unavailable: ${oneLine(last)}`;
  return d;
}

// ------------------------------------------------------------------ chain
export async function getState({ agent: signer = agent } = {}) {
  const acct = await getAccount(conn, source);
  const delegate = acct.delegate?.toBase58() ?? null;
  return {
    cluster:   CLUSTER,
    balance:   fmt(acct.amount),
    allowance: fmt(acct.delegatedAmount),
    delegate,                                   // the key the owner approved
    owner:     env.OWNER_PUBKEY,
    agent:     signer.publicKey.toBase58(),     // the key this session signs with
    approved:  delegate === signer.publicKey.toBase58(),
  };
}

export function resolveRecipient(to) {
  if (!to) return null;
  const name = String(to).trim().toLowerCase();
  if (CONTACTS[name]) return { label: name, spoken: cap(name), ata: new PublicKey(CONTACTS[name]), owner: null };
  try {
    const owner = new PublicKey(String(to).trim());
    const s = owner.toBase58();
    return { label: `${s.slice(0, 4)}…${s.slice(-4)}`, spoken: "an outside address", owner, ata: getAssociatedTokenAddressSync(mint, owner) };
  } catch { return null; }
}

// The agent signs as DELEGATE. It never touches the owner's key.
export async function buildTx(ata, owner, raw, signer = agent) {
  const tx = new Transaction();
  if (owner) tx.add(createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, ata, owner, mint));
  tx.add(createTransferCheckedInstruction(source, mint, ata, signer.publicKey, raw, DECIMALS));
  tx.feePayer        = signer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(signer);
  return tx;
}

export function readback(p) {
  const after   = p.after != null ? `, ${p.after} after this` : "";
  const verdict = p.simulated === "ok" ? "Looks good." : "The network will refuse this.";
  return `Send ${p.amount} ${TOKEN} to ${p.rcpt.spoken}? The agent's allowance is ${p.allowance}${after}. ${verdict}`;
}

// Parse → resolve → simulate. Returns a plain JSON-safe object; nothing is sent.
export async function prepare(text, { agent: signer = agent } = {}) {
  const intent = await parseIntent(text);
  const r = resolveRecipient(intent.to);
  if (!r) throw new Error(`unknown recipient: ${intent.to ?? "none found"} (known: ${Object.keys(CONTACTS).join(", ") || "none"})`);
  if (intent.amount == null) throw new Error("could not find an amount");
  if (intent.amount !== "all" && intent.amount <= 0) throw new Error("the amount has to be more than zero");

  const acct  = await getAccount(conn, source);          // read for display only
  const raw   = intent.amount === "all" ? acct.amount : BigInt(Math.round(intent.amount * Number(UNIT)));
  const tx    = await buildTx(r.ata, r.owner, raw, signer);
  const sim   = await conn.simulateTransaction(tx);
  const after = acct.delegatedAmount - raw;

  const p = {
    input: text,
    intent,
    agent: signer.publicKey.toBase58(),
    rcpt: { label: r.label, spoken: r.spoken, ata: r.ata.toBase58(), owner: r.owner?.toBase58() ?? null },
    rawStr:    raw.toString(),
    amount:    fmt(raw),
    balance:   fmt(acct.amount),
    allowance: fmt(acct.delegatedAmount),
    after:     after >= 0n ? fmt(after) : null,
    simulated: sim.value.err ? "rejected" : "ok",
  };
  p.readback = readback(p);
  return p;
}

// Rebuild with a fresh blockhash, sign, send with skipPreflight so a refusal lands on chain.
export async function execute(p, { agent: signer = agent } = {}) {
  const raw   = BigInt(p.rawStr);
  const ata   = new PublicKey(p.rcpt.ata);
  const owner = p.rcpt.owner ? new PublicKey(p.rcpt.owner) : null;
  const tx    = await buildTx(ata, owner, raw, signer);

  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const bh = await conn.getLatestBlockhash();
  let chainError = null;
  try {
    const res = await conn.confirmTransaction({ signature, ...bh }, "confirmed");
    chainError = res.value.err ?? null;
  } catch (e) {
    // web3.js quirk: an on-chain failure may resolve with value.err OR reject with the raw err object.
    if (e instanceof Error) throw e;
    chainError = e;
  }
  return { signature, url: explorer(signature), blocked: !!chainError, landed: !chainError, chainError };
}
