// scripts/seed-urls.mjs — ask Gemini (with search) for locally-owned businesses with their own websites.
//   node scripts/seed-urls.mjs "Pittsburgh, PA" 60   →  data/urls.txt   (edit it; add businesses you know)
import "dotenv/config";
import fs from "node:fs";

const city = process.argv[2] ?? "Pittsburgh, PA";
const n = Number(process.argv[3] ?? 60);
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const kinds = "independent restaurants, cafes, bakeries, hair salons, barbers, nail salons, dentists, chiropractors, physical therapists, gyms, yoga studios, plumbers, electricians, HVAC companies, auto repair shops, florists, pet groomers, tutoring centers, photographers, tailors, dry cleaners";

const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text:
      `List ${n} small, locally-owned businesses in ${city} that have their OWN website (not just a Facebook or Yelp page). ` +
      `Spread across: ${kinds}. Output one line per business: the full website URL only, nothing else. No chains, no franchises.` }] }],
    tools: [{ google_search: {} }],
  }),
});
if (!r.ok) { console.error("Gemini", r.status, (await r.text()).slice(0, 300)); process.exit(1); }
const data = await r.json();
const text = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("\n");
const urls = [...new Set((text.match(/https?:\/\/[^\s)\]>"']+/g) ?? []).map(u => u.replace(/[.,;:]+$/, "")))]
  .filter(u => !/facebook|instagram|yelp|google|linkedin|tiktok|x\.com|twitter/i.test(u));
fs.mkdirSync("data", { recursive: true });
const existing = fs.existsSync("data/urls.txt") ? fs.readFileSync("data/urls.txt", "utf8").split("\n").filter(Boolean) : [];
const merged = [...new Set([...existing, ...urls])];
fs.writeFileSync("data/urls.txt", merged.join("\n") + "\n");
console.log(`${urls.length} new URLs (${merged.length} total) → data/urls.txt`);
