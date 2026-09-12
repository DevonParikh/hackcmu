import type { CrawlResult } from "../ingest/crawl";
import { isDemo, structured } from "../llm";
import type { Assessment, Claim, Competitor, FrictionSignal, SourceDoc, FeatureKey } from "../types";
import { AssessmentSchema, FEATURE_LABELS, FEATURE_KEYS } from "../types";
import { buildCorpus } from "./corpus";

const EXPECTED: FeatureKey[] = ["contactForm", "faqPage", "mobileReady", "reviewsShown", "socialLinks"];

export async function assessCompany(opts: {
  companyName: string;
  crawl: CrawlResult;
  sources: SourceDoc[];
  competitors: Competitor[];
  signals: FrictionSignal[];
  log?: (msg: string) => void;
}): Promise<Assessment> {
  const { companyName, crawl, sources, competitors, signals } = opts;
  const heuristic = heuristicAssessment(crawl, competitors, signals);
  if (isDemo()) return heuristic;

  const canon = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.host.toLowerCase().replace(/^www\./, "")}${x.pathname.toLowerCase().replace(/\/+$/, "")}`;
    } catch {
      return u.trim().toLowerCase();
    }
  };
  const knownUrls = new Set(
    [...sources.map((s) => s.url), "user-input", crawl.rootUrl, ...crawl.pages.map((p) => p.url), ...competitors.map((c) => c.url)].map(canon),
  );
  const known = (u: string) => knownUrls.has(canon(u));
  const llm = await structured({
    schema: AssessmentSchema,
    effort: "high",
    system: `You assess a company for an owner who wants to know, plainly, what is working and what is not. Every claim needs at least one piece of evidence: a short verbatim quote or a concrete observation, with the URL it came from. Use only URLs that appear in the sources. Drop anything you cannot evidence. Friction signals are repetitive chores that cost staff time; include the deterministic ones you are given if the evidence supports them and add others you find (unanswered reviews, hiring for repetitive roles, manual processes described on the site).`,
    user: `Company: ${companyName} (${crawl.rootUrl})
Feature checklist (detected): ${JSON.stringify(crawl.features)}
Tech: ${crawl.tech.join(", ") || "none"}
Competitors: ${JSON.stringify(competitors.map((c) => ({ name: c.name, url: c.url, offering: c.offering, features: c.features, strengths: c.strengths, weaknesses: c.weaknesses })))}
Deterministic friction signals: ${JSON.stringify(signals)}

SOURCES:
${buildCorpus(sources)}`,
  });

  // A quote must actually appear on the page it cites (normalised substring, or nearly all of its words in order).
  const textByUrl = new Map<string, string>();
  for (const s of sources) textByUrl.set(canon(s.url), s.text.toLowerCase().replace(/\s+/g, " "));
  for (const p of crawl.pages) textByUrl.set(canon(p.url), (p.fullText || p.text).toLowerCase().replace(/\s+/g, " "));
  const quoteHolds = (e: { quote: string; sourceUrl: string; observed?: boolean }) => {
    if (e.observed || e.sourceUrl === "user-input") return true;
    const text = textByUrl.get(canon(e.sourceUrl));
    if (!text) return e.sourceUrl.startsWith("user-upload:");
    const q = e.quote.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
    if (!q) return false;
    if (text.includes(q)) return true;
    const words = q.split(" ").filter((w) => w.length > 3);
    const hits = words.filter((w) => text.includes(w)).length;
    return words.length > 0 && hits / words.length >= 0.8;
  };
  let dropped = 0;
  const clean = (claims: Claim[]) =>
    claims
      .map((c) => ({ ...c, evidence: c.evidence.filter((e) => known(e.sourceUrl) && quoteHolds(e)) }))
      .filter((c) => {
        if (c.evidence.length > 0) return true;
        dropped++;
        return false;
      });
  const ids = new Set<string>();
  const friction: FrictionSignal[] = [];
  for (const s of [...heuristic.frictionSignals, ...llm.frictionSignals]) {
    if (ids.has(s.id)) continue;
    const ev = s.evidence.filter((e) => known(e.sourceUrl) && quoteHolds(e));
    if (!ev.length) continue;
    ids.add(s.id);
    friction.push({ ...s, evidence: ev });
  }
  const strengths = clean(llm.strengths);
  const weaknesses = clean(llm.weaknesses);
  if (dropped) opts.log?.(`${dropped} claim(s) left out because their quote could not be found on the page they cited`);
  return {
    strengths: strengths.length ? strengths : heuristic.strengths,
    weaknesses: weaknesses.length ? weaknesses : heuristic.weaknesses,
    frictionSignals: friction,
  };
}

export function heuristicAssessment(crawl: CrawlResult, competitors: Competitor[], signals: FrictionSignal[]): Assessment {
  const { features, pages, rootUrl, tech } = crawl;
  const pageFor = (k: FeatureKey) => {
    const re: Record<FeatureKey, RegExp> = {
      onlineBooking: /book|appoint|reserv|schedule/i,
      liveChat: /./,
      faqPage: /faq|help|question/i,
      pricingPage: /pric|plan|rate|menu/i,
      contactForm: /contact/i,
      reviewsShown: /review|testimonial/i,
      blog: /blog|news|article/i,
      socialLinks: /./,
      emailCapture: /./,
      ecommerce: /shop|store|product|order/i,
      careersPage: /career|job|hiring|join/i,
      mobileReady: /./,
    };
    return pages.find((p) => re[k].test(p.url) || re[k].test(p.title))?.url ?? rootUrl;
  };
  const strengths: Claim[] = [];
  const weaknesses: Claim[] = [];
  for (const k of FEATURE_KEYS) {
    const label = FEATURE_LABELS[k];
    const rivalsWith = competitors.filter((c) => c.features?.[k]).map((c) => c.name);
    if (features[k]) {
      const rivalsWithout = competitors.filter((c) => c.features && !c.features[k]).map((c) => c.name);
      strengths.push({
        claim: rivalsWithout.length ? `${label}; ${rivalsWithout.join(", ")} ${rivalsWithout.length === 1 ? "does not have this" : "do not have this"}` : label,
        evidence: [{ quote: `${label} found on this page`, sourceUrl: pageFor(k), observed: true }],
      });
    } else if (rivalsWith.length || EXPECTED.includes(k)) {
      weaknesses.push({
        claim: rivalsWith.length ? `No ${label.toLowerCase()}, while ${rivalsWith.join(", ")} ${rivalsWith.length === 1 ? "has it" : "have it"}` : `No ${label.toLowerCase()}`,
        evidence: [
          { quote: `Not found on the ${pages.length} pages we read`, sourceUrl: rootUrl, observed: true },
          ...competitors.filter((c) => c.features?.[k]).slice(0, 2).map((c) => ({ quote: `${c.name} has ${label.toLowerCase()}`, sourceUrl: c.url, observed: true })),
        ],
      });
    }
  }
  if (tech.length) {
    strengths.unshift({ claim: `Tools already in use: ${tech.slice(0, 5).join(", ")}`, evidence: [{ quote: `Found in the site's code: ${tech.join(", ")}`, sourceUrl: rootUrl, observed: true }] });
  }
  if (pages.length >= 8) {
    strengths.unshift({ claim: `A well-documented site: ${pages.length} pages of content`, evidence: [{ quote: `Pages include ${pages.slice(0, 5).map((p) => p.title).join("; ")}`, sourceUrl: rootUrl, observed: true }] });
  } else if (pages.length <= 3) {
    weaknesses.unshift({ claim: `A thin website: only ${pages.length} page${pages.length === 1 ? "" : "s"} found`, evidence: [{ quote: `Pages found: ${pages.map((p) => p.title).join("; ") || "none"}`, sourceUrl: rootUrl, observed: true }] });
  }
  return { strengths: strengths.slice(0, 8), weaknesses: weaknesses.slice(0, 8), frictionSignals: signals };
}
