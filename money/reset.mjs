// reset.mjs — the OWNER re-grants the agent's allowance. Run between demos (npm run demo does this itself).
//
//   npm run reset            → allowance back to 50
//   npm run reset -- 100     → or any number
//
// This is the one action the agent can never take itself: it needs the owner's key.

let owner;
try { owner = await import("./owner.mjs"); }
catch (e) { console.error(`\n  ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`); process.exit(1); }

const cap = Number(process.argv[2] ?? 50);
if (!Number.isFinite(cap) || cap < 0) { console.error("usage: npm run reset -- <amount>"); process.exit(1); }
try {
  const allowance = await owner.resetAllowance(cap);
  const { getState, closeAudit } = await import("./core.mjs");
  const s = await getState();
  console.log(`allowance reset → ${allowance}   (wallet holds ${s.balance})`);
  await closeAudit();
} catch (e) {
  console.error(`\n  Couldn't reset: ${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 160)}\n`);
  process.exit(1);
}
