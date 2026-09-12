// cap-test.mjs — the demo artifact.
//
//   npm i @solana/web3.js@^1.95.0 @solana/spl-token dotenv
//   node cap-test.mjs 500
//
// Two things happen, and both matter on stage:
//
//   1. SIMULATE. This is what you read back to the user in plain language
//      before anything is signed. It is your confirmation step.
//
//   2. SEND ANYWAY with skipPreflight. Normally the RPC catches a doomed
//      transaction in preflight and it never reaches the chain, so you get
//      an error string and nothing else. skipPreflight forces it through:
//      it lands, the program rejects it, and you get a real signature and a
//      real Solana Explorer page showing a failed transfer.
//
//      That page is the strongest 10 seconds of your pitch. A judge can
//      argue with your architecture slide. They cannot argue with a block
//      explorer.

import {
  Connection, Keypair, PublicKey, Transaction,
} from "@solana/web3.js";
import { createTransferCheckedInstruction } from "@solana/spl-token";
import fs from "node:fs";
import "dotenv/config";

const {
  SOLANA_RPC = "https://api.devnet.solana.com",
  MINT, OWNER_ATA, RAVI_ATA, AGENT_KEYPAIR,
  DECIMALS = "6",
} = process.env;

if (!MINT || !OWNER_ATA || !RAVI_ATA || !AGENT_KEYPAIR) {
  console.error("Missing env. Run floor.sh first, then: cp ~/hackcmu/.env .env");
  process.exit(1);
}

const decimals = Number(DECIMALS);
const human = Number(process.argv[2] ?? 500);
const raw = BigInt(Math.round(human * 10 ** decimals));

const agent = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(AGENT_KEYPAIR, "utf8")))
);

const conn = new Connection(SOLANA_RPC, "confirmed");

// The agent signs as DELEGATE, not owner. It never sees the owner's key.
const ix = createTransferCheckedInstruction(
  new PublicKey(OWNER_ATA),
  new PublicKey(MINT),
  new PublicKey(RAVI_ATA),
  agent.publicKey,
  raw,
  decimals
);

const tx = new Transaction().add(ix);
tx.feePayer = agent.publicKey;
tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
tx.sign(agent);

console.log(`\nAgent is attempting to move ${human} tokens.\n`);

// ---- 1. simulate: your human-readable confirmation step
const sim = await conn.simulateTransaction(tx);
if (sim.value.err) {
  console.log(`SIMULATION: rejected — ${JSON.stringify(sim.value.err)}`);
  console.log("   (0x1 = InsufficientFunds. Not the balance. The allowance.)\n");
} else {
  console.log("SIMULATION: would succeed. Within the delegated allowance.\n");
}

// ---- 2. send regardless, so the outcome is a permanent on-chain record
const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
const bh = await conn.getLatestBlockhash();
const res = await conn.confirmTransaction(
  { signature: sig, ...bh },
  "confirmed"
);

console.log(res.value.err ? "ON CHAIN: REJECTED" : "ON CHAIN: settled");
console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);

if (res.value.err) {
  console.log("Say this next, out loud, and then stop talking for two seconds:");
  console.log('  "The agent did exactly what the attacker asked. The network');
  console.log('   said no. That limit is not in my prompt — it is on the chain."\n');
}
