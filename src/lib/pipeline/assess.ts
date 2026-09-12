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
}): Promise<Assessment> {
  const { companyName, crawl, sources, competitors, signals } = opts;
  const heuristic = heuristicAssessment(crawl, competitors, signals);
  if (isDemo()) return heuristic;

  const knownUrls = new Set([...sources.map((s) => s.url), "user-input", crawl.rootUrl, ...crawl.pages.map((p) => p.url)]);
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

  const clean = (claims: Claim[]) =>
    claims
      .map((c) => ({ ...c, evidence: c.evidence.filter((e) => knownUrls.has(e.sourceUrl)) }))
      .filter((c) => c.evidence.length > 0);
  const ids = new Set<string>();
  const friction: FrictionSignal[] = [];
  for (const s of [...heuristic.frictionSignals, ...llm.frictionSignals]) {
    if (ids.has(s.id)) continue;
    const ev = s.evidence.filter((e) => knownUrls.has(e.sourceUrl));
    if (!ev.length) continue;
    ids.add(s.id);
    friction.push({ ...s, evidence: ev });
  }
  return {
    strengths: clean(llm.strengths).length ? clean(llm.strengths) : heuristic.strengths,
    weaknesses: clean(llm.weaknesses).length ? clean(llm.weaknesses) : heuristic.weaknesses,
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
        claim: rivalsWithout.length ? `${label} in place; ${rivalsWithout.join(", ")} lack it` : `${label} in place`,
        evidence: [{ quote: `${label} detected`, sourceUrl: pageFor(k) }],
      });
    } else if (rivalsWith.length || EXPECTED.includes(k)) {
      weaknesses.push({
        claim: rivalsWith.length ? `No ${label.toLowerCase()}, while ${rivalsWith.join(", ")} offer it` : `No ${label.toLowerCase()} found`,
        evidence: [
          { quote: `${label} not detected across ${pages.length} crawled pages`, sourceUrl: rootUrl },
          ...competitors.filter((c) => c.features?.[k]).slice(0, 2).map((c) => ({ quote: `${c.name} has ${label.toLowerCase()}`, sourceUrl: c.url })),
        ],
      });
    }
  }
  if (tech.length) {
    strengths.unshift({ claim: `Tools and integrations in use: ${tech.slice(0, 5).join(", ")}`, evidence: [{ quote: tech.join(", "), sourceUrl: rootUrl }] });
  }
  if (pages.length >= 8) {
    strengths.unshift({ claim: `Well-documented site with ${pages.length} pages of content`, evidence: [{ quote: pages.slice(0, 5).map((p) => p.title).join("; "), sourceUrl: rootUrl }] });
  } else if (pages.length <= 3) {
    weaknesses.unshift({ claim: `Thin website: only ${pages.length} page(s) found`, evidence: [{ quote: pages.map((p) => p.title).join("; ") || "no pages", sourceUrl: rootUrl }] });
  }
  return { strengths: strengths.slice(0, 8), weaknesses: weaknesses.slice(0, 8), frictionSignals: signals };
}
