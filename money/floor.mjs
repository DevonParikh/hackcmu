// floor.mjs — HackCMU 2026. The on-chain spending cap, no Rust toolchain.
//
//   npm run floor                                    (devnet)
//   SOLANA_RPC=http://127.0.0.1:8899 npm run floor   (against `npm run localnet` when devnet is unreachable)
//
// Idempotent: re-run it whenever you lose track of state. Re-running also
// resets the agent's allowance back to CAP, which is your demo reset button.
// Writes keys/ and .env in the repo root (both git-ignored).
//
// DEVNET ONLY. These keypairs are throwaway. Never point this at mainnet.

import {
  Connection, Keypair, LAMPORTS_PER_SOL,
  SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint, getMint, getOrCreateAssociatedTokenAccount, getAccount,
  mintTo, approve, transfer,
} from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RPC      = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const CLUSTER  = /mainnet/i.test(RPC) ? "mainnet" : /devnet/i.test(RPC) ? "devnet" : /127\.0\.0\.1|localhost/.test(RPC) ? "localnet" : "custom";
const ROOT     = process.env.HACKCMU_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");   // the repo root
const KEYS     = path.join(ROOT, "keys");
const DECIMALS = 6;
const UNIT     = 10n ** BigInt(DECIMALS);
const SUPPLY   = 1000n * UNIT;   // minted to the owner
const CAP      =   50n * UNIT;   // the agent's total allowance
const UNDER    =   10n * UNIT;   // proof 1: must succeed
const OVER     =  500n * UNIT;   // proof 2: chain must refuse

const say = s => console.log(`\n\x1b[1m==> ${s}\x1b[0m`);
const ok  = s => console.log(`    \x1b[32m✓\x1b[0m ${s}`);
const bad = s => console.log(`    \x1b[31m✗\x1b[0m ${s}`);
const fmt = raw => (Number(raw) / Number(UNIT)).toString();
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (CLUSTER === "mainnet") { bad("Refusing to run against mainnet. This project is devnet-only; unset SOLANA_RPC."); process.exit(1); }

// One human line, never a stack trace.
process.on("uncaughtException", e => {
  const m = String(e?.message ?? e).replace(/\s+/g, " ");
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out/i.test(m))
    bad(`Can't reach the chain at ${RPC}. ${CLUSTER === "localnet" ? "Start it with `npm run localnet`." : "Check the wifi and try again."}`);
  else if (/429|rate.?limit|too many/i.test(m)) bad("Devnet is rate-limiting us. Wait a minute and re-run.");
  else bad(m.slice(0, 200));
  if (process.argv.includes("--debug")) console.error(e);
  process.exit(1);
});

console.log(`    ${CLUSTER} · ${RPC}` + (CLUSTER === "localnet" ? "   (a private ledger, not a public chain)" : ""));
fs.mkdirSync(KEYS, { recursive: true });

// Written in solana-cli's JSON format, so `solana address -k keys/agent.json` works too.
function loadOrCreate(name) {
  const p = path.join(KEYS, `${name}.json`);
  if (fs.existsSync(p)) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

async function airdrop(conn, pubkey, sol) {
  for (let i = 1; i <= 5; i++) {
    try {
      const sig = await conn.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
      const bh  = await conn.getLatestBlockhash();
      await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      return true;
    } catch (e) {
      console.log(`    airdrop attempt ${i} failed, retrying in 6s…`);
      await sleep(6000);
    }
  }
  return false;
}

const conn = new Connection(RPC, "confirmed");

// ---------------------------------------------------------------- keypairs
say("Keypairs");
const owner  = loadOrCreate("owner");
const agent  = loadOrCreate("agent");
const ravi   = loadOrCreate("ravi");
const mintKp = loadOrCreate("mint");
console.log(`    owner  ${owner.publicKey}`);
console.log(`    agent  ${agent.publicKey}   <- the delegate. This is the key the LLM gets.`);
console.log(`    ravi   ${ravi.publicKey}`);

// ---------------------------------------------------------------- funding
say(`Funding owner${CLUSTER === "devnet" ? " (the devnet faucet is flaky at hackathons — be patient)" : ""}`);
let bal = await conn.getBalance(owner.publicKey);
if (bal < 0.5 * LAMPORTS_PER_SOL) {
  if (!(await airdrop(conn, owner.publicKey, 1))) {
    bad("Airdrop failed 5x. Use the web faucet: https://faucet.solana.com");
    bad(`Paste this address: ${owner.publicKey}`);
    bad("Then re-run this script.");
    process.exit(1);
  }
  bal = await conn.getBalance(owner.publicKey);
}
ok(`owner has ${bal / LAMPORTS_PER_SOL} SOL`);

const agentBal = await conn.getBalance(agent.publicKey);
if (agentBal < 0.05 * LAMPORTS_PER_SOL) {
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: owner.publicKey,
    toPubkey:   agent.publicKey,
    lamports:   0.2 * LAMPORTS_PER_SOL,
  }));
  await sendAndConfirmTransaction(conn, tx, [owner]);
  ok(`agent funded for fees: ${(await conn.getBalance(agent.publicKey)) / LAMPORTS_PER_SOL} SOL`);
} else {
  ok(`agent already has ${agentBal / LAMPORTS_PER_SOL} SOL`);
}

// ---------------------------------------------------------------- the token
say("Payment token");
let mint = mintKp.publicKey;
try {
  await getMint(conn, mint);
  ok(`mint exists: ${mint}`);
} catch {
  mint = await createMint(conn, owner, owner.publicKey, null, DECIMALS, mintKp);
  ok(`mint created: ${mint}`);
}

const ownerAta = await getOrCreateAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
let acct = await getAccount(conn, ownerAta.address);
if (acct.amount < UNIT) {
  await mintTo(conn, owner, mint, ownerAta.address, owner, SUPPLY);
  ok(`minted ${fmt(SUPPLY)} to owner`);
} else {
  ok(`owner holds ${fmt(acct.amount)}`);
}
ok(`owner ATA: ${ownerAta.address}`);

say("Recipient account");
const raviAta = await getOrCreateAssociatedTokenAccount(conn, owner, mint, ravi.publicKey);
ok(`ravi ATA: ${raviAta.address}`);

// ---------------------------------------------------------------- handoff (early, so it exists even if a proof fails)
const envPath = path.join(ROOT, ".env");
// Merge into .env: the chain lines are replaced, everything else (API keys, Atlas URI, Auth0) is kept.
const chainEnv = {
  SOLANA_RPC: RPC, MINT: String(mint), DECIMALS: String(DECIMALS),
  OWNER_PUBKEY: String(owner.publicKey), OWNER_ATA: String(ownerAta.address),
  AGENT_PUBKEY: String(agent.publicKey), AGENT_KEYPAIR: path.join(KEYS, "agent.json"),
  RAVI_PUBKEY: String(ravi.publicKey), RAVI_ATA: String(raviAta.address),
};
const kept = (fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split("\n") : [])
  .filter(l => !Object.keys(chainEnv).some(k => l.startsWith(k + "=")));
while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
fs.writeFileSync(envPath, [...kept, ...(kept.length ? [""] : []), ...Object.entries(chainEnv).map(([k, v]) => `${k}=${v}`), ""].join("\n"));

// ---------------------------------------------------------------- THE CAP
say("Delegating a capped allowance to the agent");
await approve(conn, owner, ownerAta.address, agent.publicKey, owner, CAP);
acct = await getAccount(conn, ownerAta.address);
ok(`delegate          ${acct.delegate}`);
ok(`delegated amount  ${fmt(acct.delegatedAmount)}`);
ok(`account balance   ${fmt(acct.amount)}   <- the cap is the smaller number, and it lives on chain`);

// ---------------------------------------------------------------- proof 1
say(`PROOF 1 — agent sends ${fmt(UNDER)} (under the cap). Expect success.`);
try {
  const sig = await transfer(conn, agent, ownerAta.address, raviAta.address, agent, UNDER);
  ok(`accepted  ${CLUSTER === "devnet" ? `https://explorer.solana.com/tx/${sig}?cluster=devnet` : `${sig} (${CLUSTER}: no public explorer)`}`);
} catch (e) {
  bad(`unexpected failure: ${String(e.message ?? e).split("\n")[0]}`);
  process.exit(1);
}
acct = await getAccount(conn, ownerAta.address);

// ---------------------------------------------------------------- proof 2
say(`PROOF 2 — agent tries to send ${fmt(OVER)} (over the cap). Expect the chain to refuse.`);
try {
  await transfer(conn, agent, ownerAta.address, raviAta.address, agent, OVER);
  bad("It went through. The approve did not take. Do not build on this until it fails.");
  process.exit(1);
} catch (e) {
  const msg  = String(e.message ?? e);
  const logs = e.logs ?? e.transactionLogs ?? [];
  const hit  = logs.find(l => /insufficient/i.test(l)) ?? msg.split("\n")[0];
  ok("REJECTED — this is the win condition");
  console.log(`    ${hit.slice(0, 120)}`);
  if (!/0x1|insufficient/i.test(msg + logs.join(" "))) {
    bad("…but not for the reason expected. Read the error above before trusting this.");
  }
  console.log(`
    custom program error 0x1 = SPL Token InsufficientFunds.
    The owner holds ${fmt(acct.amount)}. The DELEGATE holds a ${fmt(acct.delegatedAmount)} allowance.
    That distinction is the entire project.`);
}

// ---------------------------------------------------------------- done
say("Floor secured.");
console.log(`
    Wrote ${envPath}
    ${CLUSTER === "devnet" ? `Explorer: https://explorer.solana.com/address/${ownerAta.address}?cluster=devnet` : `Owner token account: ${ownerAta.address}`}

    Next:  npm run demo
    That runs the 3-minute path: the owner sets the cap, the agent pays 20, a
    jailbreak asks for 500, the chain refuses it, and the audit log shows both.
    (Preflight stopped PROOF 2 before it landed; the demo sends with skipPreflight
    so the refusal lands on chain and gets an explorer link.)${CLUSTER === "localnet" ? `

    This was LOCALNET. .env now points SOLANA_RPC at it; for devnet, re-run
    without SOLANA_RPC set (keys/ are reused, so the addresses stay the same).` : ""}
`);
