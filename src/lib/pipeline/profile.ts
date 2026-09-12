import type { CrawlResult } from "../ingest/crawl";
import { isDemo, structured } from "../llm";
import type { CompanyProfile, SourceDoc } from "../types";
import { CompanyProfileSchema } from "../types";
import { buildCorpus, stripTitle } from "./corpus";

export async function profileCompany(opts: {
  crawl: CrawlResult;
  sources: SourceDoc[];
  nameHint: string;
}): Promise<CompanyProfile> {
  const { crawl, sources, nameHint } = opts;
  const home = crawl.pages[0];
  const fallbackName = nameHint || (home ? stripTitle(home.title) : new URL(crawl.rootUrl).host);

  if (isDemo()) return heuristicProfile(crawl, fallbackName);

  const profile = await structured({
    schema: CompanyProfileSchema,
    effort: "medium",
    system:
      "You profile small and mid-sized companies from their public web presence. Be concrete and conservative: only state what the sources support, and say 'not published' when something is absent. Cite the source indices you relied on.",
    user: `Company website: ${crawl.rootUrl}\n${nameHint ? `Name hint: ${nameHint}\n` : ""}Detected tech: ${crawl.tech.join(", ") || "none"}\nDetected contact: ${JSON.stringify(crawl.contact)}\n\nSOURCES:\n${buildCorpus(sources)}`,
  });
  if (!profile.name.trim()) profile.name = fallbackName;
  return profile;
}

export function heuristicProfile(crawl: CrawlResult, name: string): CompanyProfile {
  const { pages, features, contact } = crawl;
  const home = pages[0];
  const about = pages.find((p) => /about/i.test(p.url) || /about/i.test(p.title));
  const text = pages.map((p) => p.text).join("\n");
  const lower = text.toLowerCase();
  const firstPara = (p?: { text: string }) => (p?.text.split("\n").find((l) => l.length > 60) ?? "").slice(0, 300);
  const tagline = home?.description || firstPara(home) || `${name} — see ${crawl.rootUrl}`;
  const offering = [firstPara(about), firstPara(home)].filter(Boolean).join(" ").slice(0, 500) || tagline;

  const segments: string[] = [];
  const segMap: [string, RegExp][] = [
    ["families", /famil/],
    ["local residents", /neighborhood|local|community/],
    ["small businesses", /small business/],
    ["businesses", /\bb2b\b|enterprise|companies|teams/],
    ["students", /student/],
    ["patients", /patient/],
    ["homeowners", /homeowner|your home/],
    ["event hosts", /wedding|event|catering/],
  ];
  for (const [s, re] of segMap) if (re.test(lower)) segments.push(s);
  if (!segments.length) segments.push("general public");

  const businessModel = features.ecommerce
    ? "Online sales and in-person purchases"
    : features.pricingPage
      ? "Services with published prices"
      : "Services quoted per customer";
  const priceMatch = text.match(/\$\s?\d{1,5}(\.\d{2})?/g);
  const pricingSummary = priceMatch ? `Prices published on the site (e.g. ${[...new Set(priceMatch)].slice(0, 3).join(", ")})` : "Prices not published";
  const staffMentions = (lower.match(/\bour team\b|\bstaff\b|\bemployees\b/g) || []).length;
  const sizeEstimate = /franchise|locations across|nationwide/.test(lower)
    ? "Multi-location (site mentions several locations)"
    : staffMentions > 2 || features.careersPage
      ? "Small team, 2-20 staff (site mentions a team and hiring)"
      : "Solo or very small team (no team or hiring pages found)";
  const channels: string[] = [];
  if (contact.phone) channels.push("phone");
  if (contact.email) channels.push("email");
  if (features.contactForm) channels.push("web form");
  if (features.onlineBooking) channels.push("online booking");
  if (features.ecommerce) channels.push("online store");
  if (contact.address) channels.push("walk-in");
  if (!channels.length) channels.push("website");
  const exclam = (text.match(/!/g) || []).length / Math.max(1, text.length / 1000);
  const toneOfVoice = /\bwe're\b|\by'all\b|\bfolks\b/.test(lower) || exclam > 1.5 ? "Warm and casual" : /\bclients\b|\bprofessional\b|\bconsultation\b/.test(lower) ? "Professional and reassuring" : "Friendly and straightforward";
  return {
    name,
    tagline: tagline.slice(0, 200),
    offering,
    customerSegments: segments.slice(0, 4),
    businessModel,
    pricingSummary,
    sizeEstimate,
    channels,
    toneOfVoice,
    location: contact.address,
    sourceIndices: pages.slice(0, 3).map((_, i) => i),
  };
}
