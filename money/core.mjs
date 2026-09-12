// core.mjs — the agent's brain. Shared by agent.mjs (CLI) and server.mjs (API + page).
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
export const DECIMALS = Number(env.DECIMALS ?? 6);
export const UNIT     = 10n ** BigInt(DECIMALS);
export const TOKEN    = env.TOKEN_NAME ?? "USDH";

// name → token account. Add teammates here.
export const CONTACTS = { ravi: env.RAVI_ATA };

export const fmt      = raw => (Number(raw) / Number(UNIT)).toString();
export const explorer = sig => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const oneLine  = e   => String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 140);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cap   = s  => s ? s[0].toUpperCase() + s.slice(1) : s;

const conn   = new Connection(RPC, "confirmed");
const agent  = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(env.AGENT_KEYPAIR, "utf8"))));
const mint   = new PublicKey(env.MINT);
const source = new PublicKey(env.OWNER_ATA);

// ------------------------------------------------------------------ audit log
let mongo = null;
async function attempts() {
  if (!mongo) {
    const { MongoClient } = await import("mongodb");
    mongo = new MongoClient(env.MONGODB_URI);
    await mongo.connect();
  }
  return mongo.db("hackcmu").collection("attempts");
}

// Never throws. Returns where the record went, or why it didn't.
export async function audit(doc) {
  doc.ts = new Date().toISOString();
  try {
    if (env.MONGODB_URI) {
      await (await attempts()).insertOne(doc);
      return "MongoDB hackcmu.attempts";
    }
    fs.appendFileSync("attempts.jsonl", JSON.stringify(doc) + "\n");
    return "attempts.jsonl";
  } catch (e) {
    return `audit failed: ${oneLine(e)}`;
  }
}

export async function readLog(n = 10) {
  if (env.MONGODB_URI) {
    return (await attempts()).find({}, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(n).toArray();
  }
  if (!fs.existsSync("attempts.jsonl")) return [];
  return fs.readFileSync("attempts.jsonl", "utf8").trim().split("\n")
           .filter(Boolean).map(l => JSON.parse(l)).slice(-n).reverse();
}

export async function closeAudit() { if (mongo) { await mongo.close(); mongo = null; } }

// ------------------------------------------------------------------ intent
function normalizeAmount(a) {
  if (a == null) return null;
  if (typeof a === "string" && /^(all|everything|every|entire|max)/i.test(a.trim())) return "all";
  const n = Number(a);
  return Number.isFinite(n) ? n : null;
}

function parseDumb(text) {
  const t    = text.toLowerCase();
  const name = Object.keys(CONTACTS).find(n => t.includes(n));
  const addr = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/)?.[0];
  const all  = /\b(everything|all of it|all|entire|whole|max)\b/.test(t);
  const num  = t.match(/(\d+(?:\.\d+)?)/);
  return { to: name ?? addr ?? null, amount: all ? "all" : num ? Number(num[1]) : null, parser: "regex" };
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
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 120)}`);
  const data = await res.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const out  = JSON.parse(raw.replace(/```json|```/g, "").trim());
  return { to: out.to ?? null, amount: normalizeAmount(out.amount), parser: model };
}

// Gemini, retried once; then the regex parser so a 503 can never take the demo down.
export async function parseIntent(text) {
  if (!env.GEMINI_API_KEY) return parseDumb(text);
  let last;
  for (let i = 0; i < 2; i++) {
    try { return await parseWithGemini(text); }
    catch (e) { last = e; if (i === 0) await sleep(1200); }
  }
  const d = parseDumb(text);
  d.parser = "regex (fallback)";
  d.note   = `Gemini unavailable: ${oneLine(last)}`;
  return d;
}

// ------------------------------------------------------------------ chain
export async function getState() {
  const acct = await getAccount(conn, source);
  return {
    balance:   fmt(acct.amount),
    allowance: fmt(acct.delegatedAmount),
    delegate:  acct.delegate?.toBase58() ?? null,
    owner:     env.OWNER_PUBKEY,
    agent:     agent.publicKey.toBase58(),
  };
}

function resolveRecipient(to) {
  if (to && CONTACTS[to]) return { label: to, spoken: cap(to), ata: new PublicKey(CONTACTS[to]), owner: null };
  try {
    const owner = new PublicKey(to);
    return { label: `${to.slice(0, 4)}…${to.slice(-4)}`, spoken: "an outside address", owner, ata: getAssociatedTokenAddressSync(mint, owner) };
  } catch { return null; }
}

// The agent signs as DELEGATE. It never touches the owner's key.
async function buildTx(ata, owner, raw) {
  const tx = new Transaction();
  if (owner) tx.add(createAssociatedTokenAccountIdempotentInstruction(agent.publicKey, ata, owner, mint));
  tx.add(createTransferCheckedInstruction(source, mint, ata, agent.publicKey, raw, DECIMALS));
  tx.feePayer        = agent.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(agent);
  return tx;
}

export function readback(p) {
  const after   = p.after != null ? `, ${p.after} after this` : "";
  const verdict = p.simulated === "ok" ? "Looks good." : "The network will refuse this.";
  return `Send ${p.amount} ${TOKEN} to ${p.rcpt.spoken}? The agent's allowance is ${p.allowance}${after}. ${verdict}`;
}

// Parse → resolve → simulate. Returns a plain JSON-safe object; nothing is sent.
export async function prepare(text) {
  const intent = await parseIntent(text);
  const r = resolveRecipient(intent.to);
  if (!r) throw new Error(`unknown recipient: ${intent.to ?? "none found"}`);
  if (intent.amount == null) throw new Error("could not find an amount");

  const acct  = await getAccount(conn, source);          // read for display only
  const raw   = intent.amount === "all" ? acct.amount : BigInt(Math.round(intent.amount * Number(UNIT)));
  const tx    = await buildTx(r.ata, r.owner, raw);
  const sim   = await conn.simulateTransaction(tx);
  const after = acct.delegatedAmount - raw;

  const p = {
    input: text,
    intent,
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
export async function execute(p) {
  const raw   = BigInt(p.rawStr);
  const ata   = new PublicKey(p.rcpt.ata);
  const owner = p.rcpt.owner ? new PublicKey(p.rcpt.owner) : null;
  const tx    = await buildTx(ata, owner, raw);

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
