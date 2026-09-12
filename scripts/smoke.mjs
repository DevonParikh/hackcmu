// End-to-end smoke test: analyze a site, build a tool, chat with it, check MongoDB.
// Usage: BASE=http://127.0.0.1:3000 SITE=http://127.0.0.1:8081 RIVAL=http://127.0.0.1:8082 node scripts/smoke.mjs
import { MongoClient } from "mongodb";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const SITE = process.env.SITE || "http://127.0.0.1:8081";
const RIVAL = process.env.RIVAL || "";
const MONGO = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/tailor";

const fails = [];
function check(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails.push(msg);
}
async function j(path, init) {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

const start = await j("/api/analyze", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: SITE, competitors: RIVAL ? [RIVAL] : [], pain: "answering the same phone calls about cake orders and hours" }),
});
check(start.res.ok && start.body.runId, `POST /api/analyze -> runId ${start.body.runId}`);
const runId = start.body.runId;

let payload;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  payload = (await j(`/api/runs/${runId}`)).body;
  if (payload.run && (payload.run.status === "done" || payload.run.status === "failed")) break;
}
check(payload.run.status === "done", `run finished with status ${payload.run.status}${payload.run.error ? " (" + payload.run.error + ")" : ""}`);
console.log("  log:", payload.run.log.map((l) => l.msg).join(" | ").slice(0, 600));
const { company, run } = payload;
check(company && company.profile && company.profile.name, `company profiled: ${company?.profile?.name}`);
check(company.pageCount >= 5, `crawled ${company.pageCount} pages`);
check(company.contact.email === "hello@maplestreetbakery.com", `contact email detected: ${company.contact.email}`);
check(company.contact.phone?.includes("412"), `contact phone detected: ${company.contact.phone}`);
check(company.features && company.features.careersPage === true, "careers page detected");
check(company.features && company.features.liveChat === false, "no live chat detected on the company site");
check(company.brand.primary === "#8b3a2f", `brand primary color: ${company.brand.primary}`);
check(run.assessment && run.assessment.strengths.length > 0, `${run.assessment?.strengths.length} strengths`);
check(run.assessment && run.assessment.weaknesses.length > 0, `${run.assessment?.weaknesses.length} weaknesses`);
const sigIds = run.assessment?.frictionSignals.map((s) => s.id) || [];
check(sigIds.includes("support_by_email_only"), `friction signals: ${sigIds.join(", ")}`);
check(sigIds.includes("phone_only_booking"), "phone-only ordering signal found");
check(sigIds.includes("hiring_front_desk"), "hiring for front desk signal found");
const allEvidence = [...run.assessment.strengths, ...run.assessment.weaknesses, ...run.assessment.frictionSignals].flatMap((c) => c.evidence);
check(allEvidence.every((e) => e.sourceUrl && e.quote), `every claim has evidence with a URL (${allEvidence.length} items)`);
if (RIVAL) {
  check(run.competitors.length === 1, `competitor compared: ${run.competitors.map((c) => c.name).join(", ")}`);
  check(run.competitors[0]?.features?.liveChat === true && run.competitors[0]?.features?.faqPage === true, "competitor features detected (live chat, FAQ)");
  check(run.assessment.weaknesses.some((w) => /faq/i.test(w.claim) && /Crust/.test(w.claim)), "weakness names the competitor that has an FAQ");
}
check(run.opportunities.length === 3, `3 opportunities ranked: ${run.opportunities.map((o) => o.templateId + "=" + o.score).join(", ")}`);
check(run.opportunities[0].templateId === "support_faq" || run.opportunities[0].templateId === "booking_intake", `top recommendation is ${run.opportunities[0].templateId}`);

// Build the top recommendation
const build = await j(`/api/runs/${runId}/build`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ templateId: "support_faq", name: "Ask Maple", offLimits: ["medical advice"] }),
});
check(build.res.ok && build.body.tool, `built tool ${build.body.tool?._id} (${build.res.status} ${build.body.error || ""})`);
const tool = build.body.tool;
check(tool.evalSummary.total === 10, `self-test ran ${tool.evalSummary.total} cases, ${tool.evalSummary.passed} passed`);
check(tool.evalSummary.passed >= 8, "at least 8/10 self-test cases pass");
check(tool.knowledgeCount >= 5, `${tool.knowledgeCount} knowledge chunks`);

// Public config must not leak prompt or knowledge
const pub = await j(`/api/tools/${tool._id}`);
check(pub.res.ok && pub.body.name === "Ask Maple" && !("systemPrompt" in pub.body) && !("knowledge" in pub.body), "public tool config hides prompt and knowledge");
check(pub.body.brand.primary === "#8b3a2f", "tool carries brand color");

// Chat with it
const chat1 = await j(`/api/tools/${tool._id}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "What are your hours?" }) });
check(chat1.res.ok && /7am to 3pm|Tuesday/i.test(chat1.body.reply), `hours answer: ${chat1.body.reply?.slice(0, 120)}`);
const chat2 = await j(`/api/tools/${tool._id}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "What is your cake cancellation policy?", conversationId: chat1.body.conversationId }) });
check(/48 hours|50%/i.test(chat2.body.reply), `policy answer: ${chat2.body.reply?.slice(0, 120)}`);
const chat3 = await j(`/api/tools/${tool._id}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Do you sell bicycles?", conversationId: chat1.body.conversationId }) });
check(/couldn't find|not sure|email|call/i.test(chat3.body.reply), `unknown question escalates: ${chat3.body.reply?.slice(0, 120)}`);
const chat4 = await j(`/api/tools/${tool._id}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Can you give me medical advice about gluten?", conversationId: chat1.body.conversationId }) });
check(/can't help with that/i.test(chat4.body.reply), `off-limits topic declined: ${chat4.body.reply?.slice(0, 120)}`);

// Form-mode tool
const build2 = await j(`/api/runs/${runId}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId: "review_responder" }) });
check(build2.res.ok, `built review responder ${build2.body.tool?._id}`);
const draft = await j(`/api/tools/${build2.body.tool._id}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Waited 40 minutes and nobody answered the phone. Disappointed." }) });
check(draft.res.ok && /sorry/i.test(draft.body.reply), `review reply drafted: ${draft.body.reply?.slice(0, 100)}`);

// Embed + pages
const embed = await fetch(`${BASE}/embed.js?tool=${tool._id}`);
const embedText = await embed.text();
check(embed.ok && embed.headers.get("content-type")?.includes("javascript") && embedText.includes(`/t/`), "embed.js serves a script");
for (const p of ["/", `/runs/${runId}`, `/t/${tool._id}`, `/t/${tool._id}?embed=1`]) {
  const r = await fetch(BASE + p);
  const html = await r.text();
  check(r.ok && html.includes("<html") && !/Application error|Internal Server Error/.test(html), `page ${p} renders (${r.status})`);
}
const companiesApi = await j("/api/companies");
check(companiesApi.res.ok && companiesApi.body.companies.some((c) => c.id === company._id), "GET /api/companies lists the company");

// MongoDB: data actually persisted
const mc = new MongoClient(MONGO);
await mc.connect();
const db = mc.db(new URL(MONGO).pathname.slice(1) || "tailor");
const c = await db.collection("companies").findOne({ _id: company._id });
check(c && c.profile && c.host === new URL(SITE).host, `MongoDB companies doc stored (host=${c?.host}, name=${c?.name})`);
check((await db.collection("sources").countDocuments({ runId })) === company.pageCount, "MongoDB sources stored for the run");
check((await db.collection("runs").findOne({ _id: runId }))?.toolIds?.length === 2, "MongoDB run doc references both built tools");
check((await db.collection("tools").countDocuments({ companyId: company._id })) >= 2, "MongoDB tools stored");
check((await db.collection("conversations").countDocuments({ toolId: tool._id })) === 1, "MongoDB conversation stored with history");
await mc.close();

console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASSED");
process.exit(fails.length ? 1 : 0);
