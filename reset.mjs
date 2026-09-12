// reset.mjs — the OWNER re-grants the agent's allowance. Run between demos.
//
//   node reset.mjs        → allowance back to 50
//   node reset.mjs 100    → or any number
//
// This is the one action the agent can never take itself: it needs the owner's key.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { approve, getAccount } from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const env      = process.env;
const DECIMALS = Number(env.DECIMALS ?? 6);
const UNIT     = 10n ** BigInt(DECIMALS);
const CAP      = BigInt(process.argv[2] ?? 50) * UNIT;
const fmt      = raw => (Number(raw) / Number(UNIT)).toString();

const conn  = new Connection(env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
const load  = p => Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, "utf8"))));
const owner = load(path.join(path.dirname(env.AGENT_KEYPAIR), "owner.json"));
const ata   = new PublicKey(env.OWNER_ATA);
const agent = new PublicKey(env.AGENT_PUBKEY);

await approve(conn, owner, ata, agent, owner, CAP);
const a = await getAccount(conn, ata);
console.log(`allowance reset → ${fmt(a.delegatedAmount)}   (wallet holds ${fmt(a.amount)})`);
