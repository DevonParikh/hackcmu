// scripts/export-pairs.mjs — pull every judged (claim, quote, verdict) triple out of Mongo for training.
//   node scripts/export-pairs.mjs   →  data/pairs.jsonl
import "dotenv/config";
import fs from "node:fs";
import { MongoClient } from "mongodb";

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const runs = await c.db("hackcmu").collection("runs")
  .find({ judgePairs: { $exists: true, $ne: [] } }, { projection: { judgePairs: 1, url: 1 } }).toArray();
fs.mkdirSync("data", { recursive: true });
const lines = runs.flatMap(r => r.judgePairs.map(p => JSON.stringify({ ...p, site: r.url })));
fs.writeFileSync("data/pairs.jsonl", lines.join("\n") + "\n");
const counts = {};
for (const l of lines) { const v = JSON.parse(l).verdict; counts[v] = (counts[v] ?? 0) + 1; }
console.log(`${lines.length} pairs from ${runs.length} runs → data/pairs.jsonl`, counts);
await c.close();
