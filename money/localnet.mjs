// localnet.mjs — a stand-in for devnet when devnet is unreachable (dead venue wifi, a sandbox, a rate-limited faucet).
//
//   node money/localnet.mjs                         → JSON-RPC on http://127.0.0.1:8899, websocket on 8900
//   SOLANA_RPC=http://127.0.0.1:8899 npm run floor  → the same floor.mjs, agent.mjs, demo.mjs, server, Next app
//
// What it is: the REAL SPL Token program (the bytes bundled with LiteSVM, the same program that runs on devnet)
// executed in-process, behind the dozen Solana RPC methods that @solana/web3.js and @solana/spl-token call.
// What it is not: a public chain. Nothing here is visible on an explorer. It is for development and for
// proving the floor when devnet is down; it is NOT the thing to show a judge as "on chain".
//
// The refusal you get here is the token program's own verdict — custom program error 0x1, "insufficient funds",
// raised because the DELEGATE's allowance is smaller than the transfer — byte for byte what devnet returns.

import http from "node:http";
import ws from "ws";
const WebSocketServer = ws.WebSocketServer ?? ws.Server;
import { LiteSVM } from "litesvm";
import { getTransactionDecoder, getBase58Decoder, getBase64Encoder, getBase64Decoder, address } from "@solana/kit";

const PORT  = Number(process.env.LOCALNET_PORT ?? 8899);
const quiet = process.argv.includes("--quiet");
const log   = (...a) => { if (!quiet) console.log(...a); };

const b58   = bytes => getBase58Decoder().decode(bytes);
const fromB64 = s => getBase64Encoder().encode(s);
const toB64   = bytes => getBase64Decoder().decode(bytes);
const decodeTx = getTransactionDecoder();

// Blockhash check off: every getLatestBlockhash hands out a fresh hash (so two identical sends never collide on
// the same signature, as on a live chain), and a transaction built a moment ago is still accepted.
const svm = new LiteSVM().withBlockhashCheck(false);
let slot = 1;
const status = new Map();          // signature → { slot, err, logs }
const waiting = new Map();         // signature → [{ ws, id }]

// ---------------------------------------------------------------- errors, in the RPC's JSON shape
function errJson(e) {
  // FailedTransactionMetadata.err() is a class per variant (fields are getters); render it as a real node's JSON-RPC does.
  const get = (o, k) => (typeof o?.[k] === "function" ? o[k]() : o?.[k]);
  const name = e?.constructor?.name ?? "";
  try {
    if (name === "TransactionErrorInstructionError") {
      const idx = Number(get(e, "index"));
      const inner = get(e, "err") ?? get(e, "error");
      const iname = inner?.constructor?.name ?? "";
      if (iname === "InstructionErrorCustom") return { InstructionError: [idx, { Custom: Number(get(inner, "code")) }] };
      if (iname === "InstructionErrorBorshIO") return { InstructionError: [idx, { BorshIoError: String(get(inner, "msg") ?? "") }] };
      return { InstructionError: [idx, String(inner).replace(/^InstructionErrorFieldless\s*/, "")] };
    }
  } catch { /* fall through */ }
  return String(e).replace(/^TransactionErrorFieldless\s*/, "");
}
function errText(json) {
  if (json && typeof json === "object" && json.InstructionError) {
    const [i, inner] = json.InstructionError;
    if (inner && typeof inner === "object" && "Custom" in inner) return `Error processing Instruction ${i}: custom program error: 0x${inner.Custom.toString(16)}`;
    return `Error processing Instruction ${i}: ${JSON.stringify(inner)}`;
  }
  return String(json);
}

// ---------------------------------------------------------------- chain operations
function account(addr) {
  const a = svm.getAccount(address(addr));
  if (!a?.exists) return null;
  return { data: [toB64(a.data), "base64"], executable: a.executable, lamports: Number(a.lamports), owner: a.programAddress, rentEpoch: 0, space: a.data.length };
}

function outcome(meta, sigBytes) {
  const failed = meta?.constructor?.name === "FailedTransactionMetadata";
  const inner = failed ? meta.meta() : meta;
  const sig = b58(sigBytes ?? inner.signature());
  const errJ = failed ? errJson(meta.err()) : null;
  return { sig, err: errJ, logs: inner.logs(), units: Number(inner.computeUnitsConsumed?.() ?? 0) };
}

function record(o) {
  slot++;
  status.set(o.sig, { slot, err: o.err, logs: o.logs });
  for (const w of waiting.get(o.sig) ?? []) notify(w.ws, w.id, o.sig);
  waiting.delete(o.sig);
  const tag = o.err ? `FAILED ${errText(o.err)}` : "ok";
  log(`  tx ${o.sig.slice(0, 12)}… ${tag}`);
}

function ctx() { return { slot, apiVersion: "localnet" }; }

// web3.js rebuilds a signed legacy Transaction with a fresh blockhash before simulating it and sends sigVerify:false,
// exactly as a real node would honour. LiteSVM's flag is global, so flip it around the call.
function simulate(tx, sigVerify) {
  if (!sigVerify) svm.withSigverify(false);
  try { return svm.simulateTransaction(tx); } finally { if (!sigVerify) svm.withSigverify(true); }
}
function simValue(sim) {
  const failed = sim?.constructor?.name === "FailedTransactionMetadata";
  const m = sim.meta();
  return { err: failed ? errJson(sim.err()) : null, logs: m.logs(), accounts: null, unitsConsumed: Number(m.computeUnitsConsumed?.() ?? 0), returnData: null };
}

const METHODS = {
  getVersion: () => ({ "solana-core": "localnet (LiteSVM)", "feature-set": 0 }),
  getHealth: () => "ok",
  getSlot: () => slot,
  getBlockHeight: () => slot,
  getGenesisHash: () => "LocaLNet1111111111111111111111111111111111111",
  getIdentity: () => ({ identity: "LocaLNet1111111111111111111111111111111111111" }),
  getEpochInfo: () => ({ absoluteSlot: slot, blockHeight: slot, epoch: 0, slotIndex: slot, slotsInEpoch: 432000, transactionCount: status.size }),
  getRecentPrioritizationFees: () => [],
  getFeeForMessage: () => ({ context: ctx(), value: 5000 }),
  getLatestBlockhash: () => { svm.expireBlockhash(); return { context: ctx(), value: { blockhash: svm.latestBlockhash(), lastValidBlockHeight: slot + 150 } }; },
  getMinimumBalanceForRentExemption: ([len]) => Number(svm.minimumBalanceForRentExemption(BigInt(len))),
  getBalance: ([pk]) => ({ context: ctx(), value: Number(svm.getBalance(address(pk)) ?? 0n) }),
  getAccountInfo: ([pk]) => ({ context: ctx(), value: account(pk) }),
  getMultipleAccounts: ([pks]) => ({ context: ctx(), value: pks.map(account) }),
  getTokenAccountBalance: ([pk]) => {
    const a = svm.getAccount(address(pk)); if (!a?.exists) throw rpcError(-32602, "Invalid param: could not find account");
    const amount = new DataView(a.data.buffer, a.data.byteOffset).getBigUint64(64, true);
    return { context: ctx(), value: { amount: amount.toString(), decimals: 0, uiAmount: null, uiAmountString: amount.toString() } };
  },
  requestAirdrop: ([pk, lamports]) => {
    const meta = svm.airdrop(address(pk), BigInt(lamports));
    if (!meta) throw rpcError(-32000, "airdrop failed");
    const o = outcome(meta); record(o); return o.sig;
  },
  sendTransaction: ([b64, cfg = {}]) => {
    const tx = decodeTx.decode(fromB64(b64));
    const sigBytes = Object.values(tx.signatures)[0];
    if (!cfg.skipPreflight) {
      const sim = simulate(tx, true);
      if (sim?.constructor?.name === "FailedTransactionMetadata") {
        const e = errJson(sim.err());
        log(`  preflight refused ${b58(sigBytes).slice(0, 12)}… ${errText(e)}`);
        throw rpcError(-32002, `Transaction simulation failed: ${errText(e)}`, { accounts: null, err: e, logs: sim.meta().logs(), unitsConsumed: Number(sim.meta().computeUnitsConsumed?.() ?? 0), returnData: null });
      }
    }
    const meta = svm.sendTransaction(tx);
    const o = outcome(meta, sigBytes); record(o);
    // With skipPreflight a refused transaction still lands, with its error, exactly as on a live cluster.
    return o.sig;
  },
  simulateTransaction: ([b64, cfg = {}]) => ({ context: ctx(), value: simValue(simulate(decodeTx.decode(fromB64(b64)), !!cfg.sigVerify)) }),
  getSignatureStatuses: ([sigs]) => ({ context: ctx(), value: sigs.map(s => { const st = status.get(s); return st ? { slot: st.slot, confirmations: null, err: st.err, confirmationStatus: "finalized" } : null; }) }),
  getTransaction: ([s]) => { const st = status.get(s); return st ? { slot: st.slot, meta: { err: st.err, logMessages: st.logs, fee: 5000 }, transaction: null, blockTime: Math.floor(Date.now() / 1000) } : null; },
  getSignaturesForAddress: () => [],
};

function rpcError(code, message, data) { const e = new Error(message); e.rpc = { code, message, ...(data !== undefined ? { data } : {}) }; return e; }

function handle(req) {
  const { id, method, params = [] } = req;
  const fn = METHODS[method];
  if (!fn) { console.error(`localnet: unsupported RPC method ${method}`); return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }; }
  try { return { jsonrpc: "2.0", id, result: fn(params) }; }
  catch (e) {
    if (e.rpc) return { jsonrpc: "2.0", id, error: e.rpc };
    console.error(`localnet: ${method} failed:`, e);
    return { jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message ?? e) } };
  }
}

// ---------------------------------------------------------------- HTTP
const server = http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, solana-client");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "POST") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("localnet: Solana RPC stand-in (LiteSVM). POST JSON-RPC here.\n"); }
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
    const out = Array.isArray(parsed) ? parsed.map(handle) : handle(parsed);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  });
});

// ---------------------------------------------------------------- websocket (signatureSubscribe is how web3.js confirms)
let nextSub = 1;
const subs = new Map();            // subId → { ws, sig }
function notify(ws, subId, sig) {
  const st = status.get(sig); if (!st || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ jsonrpc: "2.0", method: "signatureNotification", params: { result: { context: { slot: st.slot }, value: { err: st.err } }, subscription: subId } }));
}
const wss = new WebSocketServer({ port: PORT + 1 });
wss.on("connection", ws => {
  ws.on("message", raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    const reply = result => ws.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
    if (m.method === "signatureSubscribe") {
      const sig = m.params?.[0]; const id = nextSub++;
      subs.set(id, { ws, sig }); reply(id);
      if (status.has(sig)) setImmediate(() => notify(ws, id, sig));
      else waiting.set(sig, [...(waiting.get(sig) ?? []), { ws, id }]);
    } else if (/Unsubscribe$/.test(m.method ?? "")) { subs.delete(m.params?.[0]); reply(true); }
    else if (/Subscribe$/.test(m.method ?? "")) reply(nextSub++);
    else reply(null);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`localnet: Solana RPC stand-in on http://127.0.0.1:${PORT} (ws :${PORT + 1})`);
  console.log(`localnet: NOT devnet. Real SPL Token program, private in-process ledger, no explorer.`);
  console.log(`localnet:   SOLANA_RPC=http://127.0.0.1:${PORT} npm run floor`);
});
