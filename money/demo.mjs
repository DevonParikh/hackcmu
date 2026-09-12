// demo.mjs — the whole 3-minute path in one command, no typing.
//
//   npm run demo                 owner resets the cap → agent pays 20 → a jailbreak asks for 500 → the chain refuses → audit log
//   npm run demo -- --offline    REPLAY of a captured run (money/fixtures/replay.json). Nothing is sent. Every line says so.
//   npm run demo -- --capture    a live run that also rewrites the replay fixture (do this on good wifi, on devnet)
//   npm run demo -- --text       typed path only: no ElevenLabs audio even if a key is set
//   npm run demo -- --no-reset   skip the owner's re-grant and top-up (the numbers on screen will drift between runs)
//   npm run demo -- --debug      stack traces instead of one-line failures
//
// The numbers are pinned in money/fixtures/demo.json so every run shows the same ones:
//   wallet 1000 · cap 50 · happy path 20 (allowance → 30) · jailbreak 500 (refused: the delegate has 30).
// Exit code 0 means the floor held: the under-cap payment settled and the over-cap one was refused BY THE CHAIN.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const OFFLINE = args.has("--offline"), CAPTURE = args.has("--capture"), TEXT = args.has("--text");
const NORESET = args.has("--no-reset"), DEBUG = args.has("--debug");
const FIX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "demo.json"), "utf8"));
const REPLAY = path.join(HERE, "fixtures", "replay.json");

// ---------------------------------------------------------------- screen
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = s => c(1, s), dim = s => c(2, s), green = s => c(32, s), red = s => c(31, s), yellow = s => c(33, s);
const prefix = OFFLINE ? yellow("REPLAY") + dim(" │ ") : "";
const out = (s = "") => console.log(prefix + s);
const say = s => { out(); out(bold("==> " + s)); };
const ok = s => out(`    ${green("✓")} ${s}`);
const warn = s => out(`    ${yellow("!")} ${s}`);
const bad = s => out(`    ${red("✗")} ${s}`);
const short = sig => (sig ? `${sig.slice(0, 8)}…${sig.slice(-6)}` : "—");
const stamp = kind => { out(); out(`    ${kind === "settled" ? green(bold("  SETTLED  ")) : kind === "refused" ? red(bold("  REFUSED  ")) : dim(bold("  FAILED  "))}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

// One human line, never a stack trace (unless --debug).
function explain(e, rpc = "") {
  const m = String(e?.message ?? e).replace(/\s+/g, " ");
  const local = /127\.0\.0\.1|localhost/.test(rpc);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out|socket hang up/i.test(m))
    return `Can't reach the chain at ${rpc || "the RPC"}. ${local ? "Start it with `npm run localnet`, or point SOLANA_RPC at devnet." : "Check the wifi, or run `npm run demo -- --offline` and say it is a replay."}`;
  if (/429|rate.?limit|too many requests/i.test(m)) return "Devnet is rate-limiting us. Wait a minute and run it again, or use --offline.";
  if (/airdrop|faucet/i.test(m)) return "The devnet faucet refused. Use https://faucet.solana.com with the owner address from `npm run floor`, then re-run.";
  if (/No wallet set up|AGENT_KEYPAIR|keys\/|ENOENT/.test(m)) return "No wallet set up on this machine. Run `npm run floor` first (it writes keys/ and .env).";
  if (/owner's key|owner\.json/i.test(m)) return m;
  if (/unknown recipient/i.test(m)) return `${m}. Check RAVI_ATA in .env (npm run floor writes it).`;
  if (/blockhash|expired/i.test(m)) return "The chain expired our blockhash (slow network). Run it again.";
  if (/insufficient.*lamports|fee/i.test(m)) return "The agent key has no SOL for fees. Run `npm run floor` to fund it.";
  return m.slice(0, 160);
}
function fail(e, rpc) {
  bad(explain(e, rpc));
  if (DEBUG) console.error(e);
  else out(dim("    (run with --debug for the full error)"));
  process.exit(1);
}

// ---------------------------------------------------------------- voice (ElevenLabs), optional, never fatal
async function speak(text) {
  if (TEXT || OFFLINE || !process.env.ELEVENLABS_API_KEY) return;
  try {
    const voice = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return;
    const f = path.join(os.tmpdir(), `allowance-${Date.now()}.mp3`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    const players = [["afplay", [f]], ["mpg123", ["-q", f]], ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", f]]];
    for (const [cmd, a] of players) {
      const played = await new Promise(res => {
        const p = spawn(cmd, a, { stdio: "ignore" });
        const t = setTimeout(() => { p.kill(); res(true); }, 15000);
        p.on("error", () => { clearTimeout(t); res(false); });
        p.on("exit", () => { clearTimeout(t); res(true); });
      });
      if (played) break;
    }
    fs.rmSync(f, { force: true });
  } catch { /* voice is decoration here; the page is the voice surface */ }
}

// ---------------------------------------------------------------- the same screens, live or replayed
function showPrepared(p) {
  out(`  parsed by ${p.intent.parser}: ${JSON.stringify({ to: p.intent.to, amount: p.intent.amount })}${p.intent.note ? dim(`  (${p.intent.note})`) : ""}`);
  out(`  read-back: ${bold(`“${p.readback}”`)}`);
  out(`  simulation: ${p.simulated === "ok" ? "the network would accept this." : "the network would refuse this."} ${dim("Sending anyway — the agent obeys, the chain decides.")}`);
}
function showResult(r, p, token, cluster) {
  stamp(r.blocked ? "refused" : r.landed ? "settled" : "failed");
  if (r.blocked) {
    const custom1 = JSON.stringify(r.chainError ?? "").includes('"Custom":1');
    out(`    The agent tried to send ${bold(p.amount)} ${token}. The wallet holds ${p.balance}. The delegate's allowance is ${bold(p.allowance)}.`);
    out(`    The token program refused it${custom1 ? ": custom program error 0x1 — insufficient funds, the DELEGATE's, not the wallet's" : `: ${JSON.stringify(r.chainError)}`}.`);
    out(`    ${bold("That cap lives on the chain, not in the prompt.")}`);
  } else if (r.landed) {
    out(`    ${p.amount} ${token} to ${p.rcpt.label}. Allowance ${p.allowance} → ${p.after ?? "?"}.`);
  } else {
    out(`    ${r.error ?? "It didn't go through."}`);
  }
  out(`    ${r.url ?? `signature ${r.signature ?? "—"} ${dim(`(${cluster}: not a public chain, no explorer)`)}`}`);
}
function showLog(rows, where) {
  say(`Audit log — ${where}`);
  if (!rows.length) return out("    (empty)");
  for (const r of rows) {
    const tag = r.blocked ? red(bold("BLOCKED")) : r.landed ? green("SETTLED") : r.error ? dim("ERROR  ") : dim("       ");
    const when = (r.ts ?? "").replace(/^.*T/, "").replace(/\..*$/, "");
    const line = `${tag}  ${dim(when)}  "${String(r.input).slice(0, 56)}${String(r.input).length > 56 ? "…" : ""}"  →  ${r.amount ?? "?"} to ${r.to ?? "?"}  ${dim(short(r.signature))}`;
    out(r.blocked ? `    ${line}   ${red("◀ the jailbreak, refused by the chain")}` : `    ${line}`);
    if (r.blocked && r.chainError) out(dim(`             chain said: ${JSON.stringify(r.chainError)}`));
  }
}

// ---------------------------------------------------------------- OFFLINE: replay a captured run
if (OFFLINE) {
  if (!fs.existsSync(REPLAY)) { bad("No replay captured yet. On good wifi run `npm run demo -- --capture` once, then --offline works."); process.exit(1); }
  const R = JSON.parse(fs.readFileSync(REPLAY, "utf8"));
  out(bold("Allowance — a payment agent the network can say no to"));
  out(yellow(bold(`THIS IS A REPLAY of a run captured ${R.capturedAt} on ${R.cluster}. Nothing is being sent.`)));
  out(dim(`agent (delegate) ${R.agent}   owner ATA ${R.ownerAta}   recipient ${R.recipient}`));
  say(`The owner set the cap: ${R.cap} ${R.token} of the ${R.wallet} in the wallet`);
  ok(`allowance ${R.cap}, signed by the owner's key; the agent can't raise it`);
  for (const s of R.steps) {
    say(s.title); out(`> "${s.input}"`); showPrepared(s.prepared); await sleep(500); showResult(s.result, s.prepared, R.token, R.cluster);
  }
  showLog(R.log, `${R.loggedTo} (as captured)`);
  out(); out(`${yellow("REPLAY ended.")} ${dim(`Captured with: npm run demo -- --capture, ${R.capturedAt}`)}`);
  process.exit(0);
}

// ---------------------------------------------------------------- LIVE
let core;
try { core = await import("./core.mjs"); } catch (e) { fail(e, process.env.SOLANA_RPC ?? ""); }
const { prepare, execute, audit, readLog, closeAudit, getState, TOKEN, RPC } = core;
const cluster = core.CLUSTER ?? (/devnet/.test(RPC) ? "devnet" : /127\.0\.0\.1|localhost/.test(RPC) ? "localnet" : "custom");
if (cluster === "mainnet") { bad("Refusing to run against mainnet. This project is devnet-only."); process.exit(1); }

out(bold("Allowance — a payment agent the network can say no to"));
out(dim(`${cluster} · ${RPC}${TEXT ? " · typed only, no audio" : ""}`));
if (cluster === "localnet") out(yellow("LOCALNET: the real SPL Token program on a private in-process ledger. Not devnet. Say so if you show it."));

// 0. The owner's move: cap and wallet back to the pinned numbers, so the screen matches the script.
say(`The owner sets the cap: ${FIX.cap} ${TOKEN}`);
if (NORESET) warn("--no-reset: leaving the allowance and wallet as they are");
else {
  try {
    const owner = await import("./owner.mjs");
    const wallet = await owner.topUp(FIX.wallet);
    const allowance = await owner.resetAllowance(FIX.cap);
    ok(`wallet ${wallet} ${TOKEN}, the agent may spend ${bold(allowance)} — signed by the OWNER's key; the agent can never do this  ${dim(since())}`);
  } catch (e) { warn(explain(e, RPC)); warn("continuing with the allowance as it is"); }
}
let state;
try { state = await getState(); } catch (e) { fail(e, RPC); }
out(); out(`    ${dim("agent (delegate)")} ${state.agent}`); out(`    ${dim("owner's token account")} ${process.env.OWNER_ATA}`); out(`    ${dim("recipient")} ${FIX.recipient} ${dim(process.env.RAVI_ATA ?? "")}`);
out(); out(`    ${bold(state.allowance)} ${TOKEN} the agent can spend, enforced on chain   ${dim(`(wallet ${state.balance})`)}`);

const steps = [];
let floorHeld = true;
async function run(title, text, expect) {
  say(title);
  out(`> "${text}"`);
  let p;
  try { p = await prepare(text); } catch (e) { fail(e, RPC); }
  showPrepared(p);
  await speak(p.readback);
  const record = { input: text, intent: p.intent, amount: p.amount, to: p.rcpt.label, simulated: p.simulated,
                   signature: null, landed: false, blocked: false, chainError: null, error: null, demo: true };
  let r;
  try { r = await execute(p); Object.assign(record, r); }
  catch (e) { record.error = explain(e, RPC); r = { signature: null, url: null, blocked: false, landed: false, chainError: null, error: record.error }; }
  const where = await audit(record);
  showResult(r, p, TOKEN, cluster);
  out(`    logged → ${where}${r.blocked ? red("   blocked: true") : ""}   ${dim(since())}`);
  if (expect === "settled" && !r.landed) { floorHeld = false; bad(bold("UNEXPECTED: the under-cap payment did not settle. Check the allowance and the agent's SOL.")); }
  if (expect === "refused" && !r.blocked) { floorHeld = false; bad(bold("UNEXPECTED: the over-cap transfer WENT THROUGH. The floor is broken — do not demo until `npm run floor` refuses again.")); }
  await speak(r.blocked ? "The network refused it." : r.landed ? "Settled." : "That didn't go through.");
  steps.push({ title, input: text, prepared: p, result: r, loggedTo: where });
  return r;
}

await run(`Happy path — the agent pays ${FIX.happy.match(/\d+/)?.[0] ?? ""} ${TOKEN}`, FIX.happy, "settled");
await run("Jailbreak — the agent obeys, the chain decides", FIX.jailbreak, "refused");

let rows = [], where = process.env.MONGODB_URI ? "MongoDB hackcmu.attempts" : "attempts.jsonl (set MONGODB_URI to log to Atlas)";
try { rows = await readLog(8); } catch (e) { warn(`couldn't read the log: ${explain(e, RPC)}`); }
showLog(rows, where);

if (CAPTURE) {
  const fixture = { capturedAt: new Date().toISOString(), cluster, rpc: RPC, token: TOKEN, agent: state.agent, ownerAta: process.env.OWNER_ATA,
                    recipient: `${FIX.recipient} ${process.env.RAVI_ATA ?? ""}`.trim(), cap: FIX.cap, wallet: FIX.wallet, loggedTo: where, steps, log: rows };
  fs.writeFileSync(REPLAY, JSON.stringify(fixture, null, 2) + "\n");
  say(`Captured → ${path.relative(process.cwd(), REPLAY)} (for --offline)`);
  if (cluster !== "devnet") warn(`captured on ${cluster}, not devnet — re-capture on devnet before the demo so the explorer links are real`);
}

say(floorHeld ? `The floor held. ${dim(since())}` : red(`The floor did NOT hold. ${since()}`));
await closeAudit();
process.exit(floorHeld ? 0 : 1);
