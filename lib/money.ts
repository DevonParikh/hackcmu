// lib/money.ts — the Next app's door to the money rail in money/core.mjs.
//
// THE RULE still holds here: nothing in this file checks the allowance. refund() builds the transfer, the delegate
// signs it, and it is sent with skipPreflight so the chain's verdict lands on chain. The cap is read only to display it.
//
// Loaded lazily: a laptop without keys/ and AGENT_KEYPAIR runs everything except refunds.

import fs from "node:fs";
import path from "node:path";

type Core = typeof import("../money/core.mjs");
let corePromise: Promise<Core | null> | null = null;

export function money(): Promise<Core | null> {
  if (!corePromise) {
    corePromise = (process.env.AGENT_KEYPAIR && process.env.OWNER_ATA && process.env.MINT
      ? import("../money/core.mjs")
      : Promise.resolve(null)
    ).catch(e => { console.error("money rail unavailable:", e instanceof Error ? e.message : e); return null; });
  }
  return corePromise;
}

export type ChainState = { token: string; balance: string; allowance: string; delegate: string | null; owner: string; agent: string };

export async function chainState(): Promise<ChainState | null> {
  const core = await money(); if (!core) return null;
  return { token: core.TOKEN, ...(await core.getState()) };
}

export type RefundResult = {
  amount: string; to: string; signature: string; url: string;
  blocked: boolean; landed: boolean; chainError: unknown;
  balanceBefore: string; allowanceBefore: string; allowanceAfter: string | null;
  why: "allowance" | "balance" | "other" | null;     // which limit refused it, for the card
};

// The tool asked for a refund. Build it, sign as delegate, send. The chain decides.
export async function refund(args: { to: string; amount: number; reason: string; slug: string; asked: string; parser?: string }): Promise<RefundResult> {
  const core = await money(); if (!core) throw new Error("Refunds aren't configured on this machine (no agent keypair).");
  const r = core.resolveRecipient(args.to);
  if (!r) throw new Error(`Unknown wallet: ${args.to}`);
  const raw = BigInt(Math.round(args.amount * Number(core.UNIT)));
  const before = await core.getState();
  const p = {
    input: args.asked, intent: { to: args.to, amount: args.amount, parser: args.parser ?? "model" },
    rcpt: { label: r.label, spoken: r.spoken, ata: r.ata.toBase58(), owner: r.owner?.toBase58() ?? null },
    rawStr: raw.toString(), amount: core.fmt(raw), balance: before.balance, allowance: before.allowance, after: null, simulated: "unknown",
  };
  const res = await core.execute(p);
  const after = res.landed ? (await core.getState()).allowance : before.allowance;
  await core.audit({ input: args.asked, tool: args.slug, reason: args.reason, intent: p.intent, amount: p.amount, to: r.label,
    simulated: null, signature: res.signature, landed: res.landed, blocked: res.blocked, chainError: res.chainError, error: null });
  const why = !res.blocked ? null
    : args.amount > Number(before.balance) ? "balance"
    : args.amount > Number(before.allowance) ? "allowance"
    : "other";
  return { amount: p.amount, to: r.label, signature: res.signature, url: res.url, blocked: res.blocked, landed: res.landed,
    chainError: res.chainError, balanceBefore: before.balance, allowanceBefore: before.allowance, allowanceAfter: res.landed ? after : null, why };
}

// The one thing the agent can never do itself: the OWNER re-grants the allowance. Needs owner.json next to the agent key.
export async function setAllowance(amount: number): Promise<{ allowance: string }> {
  const core = await money(); if (!core) throw new Error("Not configured on this machine.");
  const { Keypair, PublicKey } = await import("@solana/web3.js");
  const { approve, getAccount } = await import("@solana/spl-token");
  const ownerPath = path.join(path.dirname(process.env.AGENT_KEYPAIR!), "owner.json");
  if (!fs.existsSync(ownerPath)) throw new Error("The owner's key isn't on this machine, so the allowance can't be changed here.");
  const owner = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(ownerPath, "utf8"))));
  const ata = new PublicKey(process.env.OWNER_ATA!);
  const agent = new PublicKey(process.env.AGENT_PUBKEY!);
  const cap = BigInt(Math.round(amount * Number(core.UNIT)));
  await approve(core.conn, owner, ata, agent, owner, cap);
  const a = await getAccount(core.conn, ata);
  return { allowance: core.fmt(a.delegatedAmount) };
}

export const explorerUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
