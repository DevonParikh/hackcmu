// owner.mjs — the OWNER's two powers, the ones the agent never has: re-grant the allowance, top the wallet back up.
// Both need keys/owner.json next to the agent key. Used by reset.mjs and demo.mjs. Never by the agent.

import { Keypair, PublicKey } from "@solana/web3.js";
import { approve, getAccount, mintTo } from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";
import { conn, env, UNIT, fmt } from "./core.mjs";

export function ownerKeypair() {
  const p = path.join(path.dirname(env.AGENT_KEYPAIR ?? "keys/agent.json"), "owner.json");
  if (!fs.existsSync(p)) throw new Error(`The owner's key isn't on this machine (${p}), so the allowance can't be changed here.`);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, "utf8"))));
}

const raw = n => BigInt(Math.round(Number(n) * Number(UNIT)));

// approve(): the owner signs, the agent's allowance becomes exactly `amount`. This is the cap.
export async function resetAllowance(amount) {
  const owner = ownerKeypair();
  const ata = new PublicKey(env.OWNER_ATA), agent = new PublicKey(env.AGENT_PUBKEY);
  await approve(conn, owner, ata, agent, owner, raw(amount));
  return fmt((await getAccount(conn, ata)).delegatedAmount);
}

// Mint back up to `target` so the wallet shows the same number every demo (the owner is the mint authority).
export async function topUp(target) {
  const owner = ownerKeypair();
  const ata = new PublicKey(env.OWNER_ATA);
  const acct = await getAccount(conn, ata);
  const want = raw(target);
  if (acct.amount >= want) return fmt(acct.amount);
  await mintTo(conn, owner, new PublicKey(env.MINT), ata, owner, want - acct.amount);
  return fmt((await getAccount(conn, ata)).amount);
}
