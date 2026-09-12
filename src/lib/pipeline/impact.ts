import { BUCKETS, BUCKET_LABELS } from "../buckets";
import { getTemplate } from "../templates";
import { retrieve } from "../runtime/chat";
import type { CompanyDoc, Competitor, EvalCase, FeatureKey, Intake, Opportunity, RunDoc, SourceDoc, ToolDoc } from "../types";

/**
 * Every number the report shows is computed here, deterministically, from the crawl,
 * the owner's inputs, the self-test, and logged conversations. No benchmarks, no guesses.
 */

export type CoverageState = "full" | "half" | "none";

export interface TopicRow {
  id: string;
  label: string;
  starred: boolean;
  site: CoverageState;
  files: CoverageState;
  siteSource: string | null;
  fileSource: string | null;
  test: EvalCase["outcome"] | null;
  nudge: string | null;
}

export interface Impact {
  badges: string[];
  topics: TopicRow[];
  coverageShare: number;
  writtenDown: { covered: number; total: number };
  selfServe: {
    company: { count: number; features: string[]; anyHour: boolean };
    competitors: { name: string; count: number | null; features: string[]; anyHour: boolean | null }[];
  };
  channels: { id: string; label: string; url: string | null }[];
  load: { low: number; high: number; arithmetic: string } | null;
  couldMove: { kind: "range" | "atMost" | "none"; low: number | null; high: number | null; atMost: number | null; arithmetic: string; note: string } | null;
  value: { low: number; high: number } | null;
  drafting: { low: number; high: number; arithmetic: string } | null;
  wait: { today: { low: number; high: number; label: string; source: "you" | "site"; quote: string | null; url: string | null } | null; assistantSeconds: number | null };
  selfTest: { answered: number; handedOff: number; failed: number; total: number; intervalLow: number; intervalHigh: number; latencyMedianSeconds: number; demo: boolean; starred: number } | null;
  reasons: Record<string, { signals: number; sources: number; needs: { covered: number; total: number; missing: string[] }; customerChange: string }>;
  headline: string | null;
  notChecked: string[];
}

interface Topic {
  id: string;
  label: string;
  re: RegExp;
  titleRe: RegExp;
  nudge: string;
  relevant: (ctx: { features: CompanyDoc["features"]; text: string }) => boolean;
}

const always = () => true;
const TOPICS: Topic[] = [
  { id: "hours", label: "Hours", re: /\b(opening hours|hours:|our hours|open (daily|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun|from|every)|closed (on )?(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun|weekends)|\d{1,2}(:\d{2})?\s?(am|pm)\s?(-|to|–)\s?\d{1,2}(:\d{2})?\s?(am|pm))\b/i, titleRe: /hours|contact|visit/i, nudge: "Add your opening hours (a line of text is enough)", relevant: always },
  { id: "location", label: "Location and parking", re: /\b(\d{1,5}\s+[A-Za-z0-9.'-]+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|suite)\b|located (at|in|on)|parking|directions|find us)\b/i, titleRe: /contact|location|visit|directions/i, nudge: "Add your address and parking or directions", relevant: always },
  { id: "contact", label: "How to reach you", re: /\b(call us|phone:|email us|email:|contact us|reach us|text us|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i, titleRe: /contact/i, nudge: "Add the email and phone customers should use", relevant: always },
  { id: "offer", label: "What you offer", re: /\b(we (offer|provide|bake|make|sell|specialize|do)|our (services|products|menu|team)|services include|specialt(y|ies))\b/i, titleRe: /service|product|menu|about|what we do/i, nudge: "Add a short list of what you offer", relevant: always },
  { id: "prices", label: "Prices", re: /\$\s?\d{1,5}(,\d{3})?(\.\d{2})?|\b(pricing|price list|our prices|rates|fees|from \$|starting at)\b/i, titleRe: /pric|menu|rates|fees|plans|insurance/i, nudge: "Upload a price list or menu", relevant: always },
  { id: "booking", label: "How to book or order", re: /\b(book (online|now|an appointment|a table|your)|to (book|order|schedule|reserve)|appointments?|reservations?|order online|place an order|how to order)\b/i, titleRe: /book|order|appointment|reserv|schedule/i, nudge: "Add a line on how customers book or order", relevant: ({ features, text }) => !!features?.onlineBooking || !!features?.ecommerce || /\b(appointment|reservation|book (a|an|your|online)|to order|order online)\b/i.test(text) },
  { id: "cancellation", label: "Cancellations and refunds", re: /\b(cancel(lation)?s?( policy)?|refunds?|no-?shows?|notice (required|of)|reschedul)\b/i, titleRe: /polic|terms|faq|cancel/i, nudge: "Upload your cancellation or refund policy", relevant: always },
  { id: "payment", label: "Payment methods", re: /\b(we accept|accepted payment|cash|credit cards?|debit|visa|mastercard|american express|apple pay|financing|insurance|in-network|deposit)\b/i, titleRe: /payment|insurance|fees|faq/i, nudge: "Add which payments or insurance you accept", relevant: always },
  { id: "included", label: "What is included / how it works", re: /\b(what('s| is) included|includes|how it works|the process|first (visit|session|appointment)|takes about|step[s]? (one|1|two|2)|what to expect|bring)\b/i, titleRe: /how it works|new (patients|clients|customers)|faq|process|what to expect/i, nudge: "Add what a first visit or order includes", relevant: always },
  { id: "special", label: "Special needs (allergens, accessibility)", re: /\b(allerg(y|ies|ens)|gluten|dairy-?free|vegan|nut-?free|accessib(le|ility)|wheelchair|kids?|children|pets?|dogs?)\b/i, titleRe: /faq|allerg|accessib/i, nudge: "Add allergen or accessibility information", relevant: always },
  { id: "shipping", label: "Shipping and returns", re: /\b(shipping|ships? (within|in)|delivery|returns?( policy)?|exchange)\b/i, titleRe: /shipping|returns|delivery|faq/i, nudge: "Upload your shipping and returns policy", relevant: ({ features }) => !!features?.ecommerce },
];

function coverageFor(topic: Topic, srcs: SourceDoc[]): { state: CoverageState; source: string | null } {
  let hits = 0;
  let titleHit: SourceDoc | null = null;
  let first: SourceDoc | null = null;
  for (const s of srcs) {
    const matches = (s.text.match(new RegExp(topic.re.source, topic.re.flags.includes("g") ? topic.re.flags : topic.re.flags + "g")) || []).length;
    if (!matches) continue;
    hits++;
    first ??= s;
    if (topic.titleRe.test(s.title) || topic.titleRe.test(s.url)) titleHit ??= s;
  }
  const src = titleHit ?? first;
  const label = src ? (src.kind === "user" ? src.title : src.url) : null;
  if (hits >= 2 || (hits === 1 && titleHit)) return { state: "full", source: label };
  if (hits === 1) return { state: "half", source: label };
  return { state: "none", source: null };
}

/** Wilson score interval at 80% confidence, rounded outward to 5%. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.28;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const lo = Math.max(0, Math.floor((centre - half) * 20) / 20);
  const hi = Math.min(1, Math.ceil((centre + half) * 20) / 20);
  return [lo, hi];
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const SELF_SERVE: FeatureKey[] = ["onlineBooking", "liveChat", "faqPage", "pricingPage", "contactForm", "ecommerce"];
const SELF_SERVE_LABELS: Record<string, string> = { onlineBooking: "online booking", liveChat: "live chat", faqPage: "FAQ", pricingPage: "prices", contactForm: "contact form", ecommerce: "online ordering" };

const NEEDS: Record<string, string[]> = {
  support_faq: ["hours", "contact", "offer", "prices", "cancellation"],
  booking_intake: ["booking", "hours", "offer", "contact"],
  lead_intake: ["offer", "prices", "contact"],
  staff_assistant: ["hours", "contact", "offer", "prices", "cancellation", "payment", "included"],
  review_responder: ["contact", "cancellation"],
  listing_writer: ["offer", "prices"],
};
const CUSTOMER_CHANGE: Record<string, string> = {
  support_faq: "A customer gets an answer from your own pages in seconds, any hour; anything else reaches you with your contact details attached.",
  booking_intake: "A customer leaves their request and preferred times any hour; you confirm instead of playing phone tag.",
  lead_intake: "A new inquiry arrives already sorted: who, what, when, and how to reach them.",
  staff_assistant: "Staff find the policy or procedure themselves instead of asking you.",
  review_responder: "Every review gets a considered reply draft in your voice within a minute.",
  listing_writer: "New products get consistent descriptions in your voice from a few facts.",
};

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeImpact(opts: { run: RunDoc; company: CompanyDoc; sources: SourceDoc[]; tools: ToolDoc[] }): Impact {
  const { run, company, sources, tools } = opts;
  const intake: Intake = run.intake ?? { topQuestions: [] };
  const siteSources = sources.filter((s) => s.kind !== "user");
  const publicFiles = sources.filter((s) => s.kind === "user" && s.audience !== "staff");
  const allText = sources.map((s) => s.text).join("\n");
  const primaryTool = tools[0] ?? null;
  const notChecked: string[] = [];

  // ----- Topic coverage -----
  const relevantTopics = TOPICS.filter((t) => t.relevant({ features: company.features, text: allText }));
  const testByTopic = new Map<string, EvalCase["outcome"]>();
  if (primaryTool) {
    for (const e of primaryTool.evals) {
      const topic = relevantTopics.find((t) => t.re.test(e.question) || new RegExp(t.label.split(" ")[0], "i").test(e.question));
      if (topic && !testByTopic.has(topic.id)) testByTopic.set(topic.id, e.outcome);
    }
  }
  const topics: TopicRow[] = relevantTopics.map((t) => {
    const site = coverageFor(t, siteSources);
    const files = coverageFor(t, publicFiles);
    return {
      id: t.id,
      label: t.label,
      starred: false,
      site: site.state,
      files: files.state,
      siteSource: site.source,
      fileSource: files.source,
      test: testByTopic.get(t.id) ?? null,
      nudge: site.state === "none" && files.state === "none" ? t.nudge : null,
    };
  });
  for (const q of intake.topQuestions) {
    const siteHit = retrieve(siteSources.map((s) => ({ title: s.title, url: s.url, text: s.text })), q);
    const fileHit = retrieve(publicFiles.map((s) => ({ title: s.title, url: s.url, text: s.text })), q);
    const ev = primaryTool?.evals.find((e) => e.question === q);
    topics.push({
      id: "q:" + q.slice(0, 40),
      label: q,
      starred: true,
      site: siteHit && siteHit.score >= 1 ? "full" : "none",
      files: fileHit && fileHit.score >= 1 ? "full" : "none",
      siteSource: siteHit?.chunk.url ?? null,
      fileSource: fileHit?.chunk.title ?? null,
      test: ev?.outcome ?? null,
      nudge: !siteHit && !fileHit ? "Upload or type the answer so the assistant can use it" : null,
    });
  }
  const fixed = topics.filter((t) => !t.starred);
  const best = (t: TopicRow) => (t.site === "full" || t.files === "full" ? 1 : t.site === "half" || t.files === "half" ? 0.5 : 0);
  const coverageShare = fixed.length ? fixed.reduce((n, t) => n + best(t), 0) / fixed.length : 0;
  const writtenDown = { covered: fixed.filter((t) => best(t) === 1).length, total: fixed.length };

  // ----- Self-serve vs competitors -----
  const f = company.features;
  const companyFeatures = f ? SELF_SERVE.filter((k) => f[k]).map((k) => SELF_SERVE_LABELS[k]) : [];
  const anyHour = (x: Competitor["features"] | CompanyDoc["features"]) => !!x && (x.liveChat || x.faqPage || x.onlineBooking || x.ecommerce);
  const selfServe = {
    company: { count: companyFeatures.length, features: companyFeatures, anyHour: anyHour(f) },
    competitors: run.competitors.map((c) => ({
      name: c.name,
      count: c.features ? SELF_SERVE.filter((k) => c.features![k]).length : null,
      features: c.features ? SELF_SERVE.filter((k) => c.features![k]).map((k) => SELF_SERVE_LABELS[k]) : [],
      anyHour: c.features ? anyHour(c.features) : null,
    })),
  };

  // ----- Channels today -----
  const contactPage = siteSources.find((s) => /contact/i.test(s.url) || /contact/i.test(s.title))?.url ?? company.url;
  const channels: Impact["channels"] = [];
  if (company.contact.phone) channels.push({ id: "phone", label: "Phone", url: contactPage });
  if (company.contact.email) channels.push({ id: "email", label: "Email", url: contactPage });
  if (f?.contactForm) channels.push({ id: "form", label: "Contact form", url: contactPage });
  if (f?.liveChat) channels.push({ id: "chat", label: "Live chat", url: company.url });
  if (f?.onlineBooking) channels.push({ id: "booking", label: "Online booking", url: company.url });
  if (f?.ecommerce) channels.push({ id: "order", label: "Online ordering", url: company.url });
  if (company.contact.address) channels.push({ id: "walkin", label: "Walk-in", url: contactPage });
  if (!channels.length) channels.push({ id: "site", label: "Website only", url: company.url });

  // ----- Self-test -----
  let selfTest: Impact["selfTest"] = null;
  if (primaryTool && primaryTool.evals.length) {
    const ev = primaryTool.evals;
    const answered = ev.filter((e) => e.outcome === "answered").length;
    const handedOff = ev.filter((e) => e.outcome === "handed_off").length;
    const failed = ev.length - answered - handedOff;
    const [lo, hi] = wilson(answered, ev.length);
    selfTest = {
      answered,
      handedOff,
      failed,
      total: ev.length,
      intervalLow: lo,
      intervalHigh: hi,
      latencyMedianSeconds: r1(median(ev.map((e) => e.latencyMs)) / 1000),
      demo: run.mode === "demo",
      starred: ev.filter((e) => e.starred).length,
    };
  }

  // ----- Load, could move, value -----
  let load: Impact["load"] = null;
  let couldMove: Impact["couldMove"] = null;
  let value: Impact["value"] = null;
  const shareKey = intake.routineShare ?? "unsure";
  const minKey = intake.minutesPerInquiry ?? "unsure";
  const [sLo, sHi] = BUCKETS.share[shareKey];
  const [mLo, mHi] = BUCKETS.minutes[minKey];
  if (intake.inquiriesPerWeek !== undefined && intake.inquiriesPerWeek > 0) {
    const n = intake.inquiriesPerWeek;
    load = {
      low: r1((n * sLo * mLo) / 60),
      high: r1((n * sHi * mHi) / 60),
      arithmetic: `${n} a week × ${Math.round(sLo * 100)}-${Math.round(sHi * 100)}% routine × ${mLo}-${mHi} min = ${r1((n * sLo * mLo) / 60)}-${r1((n * sHi * mHi) / 60)} h/week`,
    };
    const tid = primaryTool?.templateId ?? run.opportunities[0]?.templateId;
    if (tid === "support_faq" || tid === "staff_assistant") {
      const atMost = r1(load.high * coverageShare);
      if (selfTest) {
        couldMove = {
          kind: "range",
          low: r1(load.low * coverageShare * selfTest.intervalLow),
          high: r1(load.high * coverageShare * selfTest.intervalHigh),
          atMost,
          arithmetic: `${load.low}-${load.high} h × ${writtenDown.covered} of ${writtenDown.total} topics written down × ${Math.round(selfTest.intervalLow * 100)}-${Math.round(selfTest.intervalHigh * 100)}% answered in the test = ${r1(load.low * coverageShare * selfTest.intervalLow)}-${r1(load.high * coverageShare * selfTest.intervalHigh)} h/week`,
          note: "Handed-off and failed questions count as zero time moved; they still come to you.",
        };
      } else {
        couldMove = { kind: "atMost", low: null, high: null, atMost, arithmetic: `${load.high} h × ${writtenDown.covered} of ${writtenDown.total} topics written down = at most ${atMost} h/week`, note: "Build and test the assistant to get the lower bound." };
      }
    } else if (tid === "lead_intake" || tid === "booking_intake") {
      const share = selfTest ? selfTest.answered / selfTest.total : coverageShare;
      const atMost = r1(load.high * share);
      couldMove = { kind: "atMost", low: null, high: null, atMost, arithmetic: `${load.high} h × ${selfTest ? `${selfTest.answered} of ${selfTest.total} test requests completed` : `${writtenDown.covered} of ${writtenDown.total} topics written down`} = at most ${atMost} h/week`, note: "The details arrive collected; you still reply. Time a few replies in week one to see what that saves." };
    } else {
      couldMove = { kind: "none", low: null, high: null, atMost: null, arithmetic: "", note: "For drafting tools, see the drafting load below." };
    }
    if (intake.hourValue && couldMove?.kind === "range" && couldMove.low !== null && couldMove.high !== null) {
      value = { low: Math.round(couldMove.low * intake.hourValue), high: Math.round(couldMove.high * intake.hourValue) };
    }
  }
  let drafting: Impact["drafting"] = null;
  if (intake.itemsPerMonth && intake.itemsPerMonth > 0) {
    drafting = { low: r1((intake.itemsPerMonth * mLo) / 60), high: r1((intake.itemsPerMonth * mHi) / 60), arithmetic: `${intake.itemsPerMonth} a month × ${mLo}-${mHi} min = ${r1((intake.itemsPerMonth * mLo) / 60)}-${r1((intake.itemsPerMonth * mHi) / 60)} h/month` };
  }

  // ----- Wait -----
  let today: Impact["wait"]["today"] = null;
  if (intake.replyTime) {
    const [lo, hi] = BUCKETS.reply[intake.replyTime];
    today = { low: lo, high: hi, label: BUCKET_LABELS.reply[intake.replyTime], source: "you", quote: null, url: null };
  } else {
    for (const s of siteSources) {
      const m = s.text.match(/(?:reply|respond|get back to you|answer)[^.\n]{0,40}?within (\d+|one|two|three|a|an) (business days?|hours?|days?)/i);
      if (m) {
        const nWord = m[1].toLowerCase();
        const n = { one: 1, a: 1, an: 1, two: 2, three: 3 }[nWord] ?? Number(nWord);
        const hours = /hour/.test(m[2]) ? n : /business/.test(m[2]) ? n * 24 : n * 24;
        today = { low: 0, high: hours, label: `within ${m[1]} ${m[2]}`, source: "site", quote: m[0], url: s.url };
        break;
      }
    }
  }
  const wait: Impact["wait"] = { today, assistantSeconds: selfTest ? selfTest.latencyMedianSeconds : null };

  // ----- Reasons behind each recommendation -----
  const reasons: Impact["reasons"] = {};
  for (const o of run.opportunities as Opportunity[]) {
    const matched = (run.assessment?.frictionSignals ?? []).filter((s) => s.id.split("+").some((id) => getTemplate(o.templateId)?.signalIds.includes(id)));
    const urls = new Set(matched.flatMap((s) => s.evidence.map((e) => e.sourceUrl)));
    const needIds = NEEDS[o.templateId] ?? [];
    const rows = needIds.map((id) => topics.find((t) => t.id === id)).filter((t): t is TopicRow => !!t);
    const covered = rows.filter((t) => best(t) >= 0.5);
    reasons[o.templateId] = {
      signals: matched.length,
      sources: urls.size,
      needs: { covered: covered.length, total: rows.length, missing: rows.filter((t) => best(t) < 0.5).map((t) => t.label) },
      customerChange: CUSTOMER_CHANGE[o.templateId] ?? "",
    };
  }

  // ----- Headline and caveats -----
  let headline: string | null = null;
  if (load) {
    headline = `About ${load.low}-${load.high} hours a week go to routine questions; ${writtenDown.covered} of ${writtenDown.total} common topics are written down where an assistant can read them.`;
  } else {
    headline = `${writtenDown.covered} of ${writtenDown.total} common customer topics are written down where an assistant can read them. Add one number below to turn that into hours.`;
  }
  notChecked.push(`We read up to 25 pages of the website${company.pageCount ? ` (${company.pageCount} found)` : ""}; pages behind logins or blocked to robots were not read.`);
  notChecked.push("No reviews, inbox, or phone records were read; friction signals come from the site and what you told us.");
  if (run.competitors.length) notChecked.push("Competitor features were detected from up to 8 public pages each; a rival may keep booking or chat behind a login.");
  if (publicFiles.length || sources.some((s) => s.kind === "user")) notChecked.push("Uploaded files were used as written; we did not check that they are current or correct.");
  notChecked.push(intake.topQuestions.length ? "The self-test used your questions first, then questions we wrote from your site." : "Self-test questions were written by us from your site; list your own most-asked questions for a fairer test.");
  notChecked.push("Opening hours were not parsed, so nothing here assumes when you are open or closed.");

  return {
    badges: ["Seen on your site", "From your file", "Compared", "Your number", "Tested", "Estimate", "Measured"],
    topics,
    coverageShare,
    writtenDown,
    selfServe,
    channels,
    load,
    couldMove,
    value,
    drafting,
    wait,
    selfTest,
    reasons,
    headline,
    notChecked,
  };
}
