// scripts/timings.mjs — where does a run's time go? Median seconds per stage across finished runs.
//   node scripts/timings.mjs
import "dotenv/config";
import { MongoClient } from "mongodb";

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const runs = await c.db("hackcmu").collection("runs").find({ stage: "ranked", timings: { $exists: true } }, { projection: { timings: 1 } }).toArray();
const stages = ["scrape", "reviews", "assess", "verify", "rank", "benchmark"];
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
let prev = 0;
console.log(`${runs.length} runs · median seconds (cumulative → stage alone)`);
for (const st of stages) {
  const vals = runs.map(r => r.timings[st]).filter(v => typeof v === "number");
  const m = med(vals); if (m == null) continue;
  console.log(`  ${st.padEnd(10)} ${String(m).padStart(6)}s  →  ${(m - prev).toFixed(1).padStart(6)}s${st === "reviews" ? "   (waiting for the review search after the crawl finished)" : ""}`);
  prev = m;
}
await c.close();
