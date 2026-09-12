// scripts/export-training.mjs — every finished run → one training row: features + Gemini's hours (the label).
//   node scripts/export-training.mjs   →  data/training.jsonl
import "dotenv/config";
import fs from "node:fs";
import { MongoClient } from "mongodb";

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const runs = await c.db("hackcmu").collection("runs")
  .find({ stage: "ranked", features: { $exists: true } }, { projection: { url: 1, features: 1, assessment: 1 } }).toArray();
fs.mkdirSync("data", { recursive: true });
const rows = runs.map(r => ({
  url: r.url,
  features: r.features,
  hoursTotal: r.assessment.frictionSignals.reduce((s, f) => s + f.hoursPerWeek, 0),
  topTemplate: r.assessment.frictionSignals.sort((a, b) => b.hoursPerWeek - a.hoursPerWeek)[0]?.template ?? null,
}));
fs.writeFileSync("data/training.jsonl", rows.map(r => JSON.stringify(r)).join("\n") + "\n");
console.log(`${rows.length} rows → data/training.jsonl` + (rows.length < 30 ? "   (train on 30+; 60+ is better)" : ""));
await c.close();
