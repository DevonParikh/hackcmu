// scripts/batch.mjs — run the analysis on every URL in data/urls.txt, two at a time, against the running dev server.
//   npm run dev   (in another tab)
//   node scripts/batch.mjs [concurrency=2] [base=http://localhost:3000]
// Each run stores features, judged pairs, and the assessment in Mongo — that's the training data.
import fs from "node:fs";

const CONC = Number(process.argv[2] ?? 2);
const BASE = process.argv[3] ?? "http://localhost:3000";
const urls = fs.readFileSync("data/urls.txt", "utf8").split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"));
let i = 0, ok = 0, bad = 0;

async function runOne(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "", last = "", done = false, failed = "";
    for (;;) {
      const { value, done: end } = await reader.read(); if (end) break;
      buf += dec.decode(value, { stream: true });
      let k; while ((k = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
        const ev = /^event: (.*)$/m.exec(chunk)?.[1]; const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? "{}");
        if (ev === "log") last = data.m;
        if (ev === "done") done = true;
        if (ev === "error") failed = data.m;
      }
    }
    const s = ((Date.now() - t0) / 1000).toFixed(0);
    if (done) { ok++; console.log(`✓ ${url}  ${s}s`); } else { bad++; console.log(`✗ ${url}  ${failed || last}`); }
  } catch (e) { bad++; console.log(`✗ ${url}  ${e.message}`); }
}
async function worker() { while (i < urls.length) { const u = urls[i++]; await runOne(u); } }
console.log(`${urls.length} sites, ${CONC} at a time, against ${BASE}`);
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`done: ${ok} ok, ${bad} failed`);
