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

function heuristicProfile(crawl: CrawlResult, name: string): CompanyProfile {
  const { pages, features, contact } = crawl;
  const home = pages[0];
  const about = pages.find((p) => /about/i.test(p.url) || /about/i.test(p.title));
  const text = pages.map((p) => p.text).join("\n");
  const lower = text.toLowerCase();
  const firstPara = (p?: { text: string }) => (p?.text.split("\n").find((l) => l.length > 60) ?? "").slice(0, 300);
  const tagline = home?.description || firstPara(home) || `${name} — see ${crawl.rootUrl}`;
  // What they do: sentences that say so, before founding stories.
  const verbRe = /\b(bake|bakes|sell|sells|offer|offers|make|makes|provide|provides|specializ\w+|serve|serves|repair|clean|design|build|teach|treat|help|deliver|install|connects|sorts|is a|are a)\b/i;
  const candidates = [home?.description ?? "", ...pages.filter((p) => !/career|job|hiring|blog|news/i.test(p.url)).flatMap((p) => p.text.split(/(?<=[.!?])\s+|\n+/))]
    .map((x) => x.trim())
    .filter((x) => x.length > 30 && x.length < 260 && verbRe.test(x) && /\b(we|our|[A-Z][\w&' ]{2,40} (offers|provides|specializes|is|bakes|makes|sells|connects))\b/.test(x))
    .map((x) => ({ x, score: (x.match(/,/g) || []).length * 0.5 + (x.length >= 60 ? 1 : 0) + (/\b(estimate|policy|notice|fee|cancel)\b/i.test(x) ? -2 : 0) }))
    .sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  for (const c of candidates) if (!picked.includes(c.x)) picked.push(c.x);
  const offering = (picked.length ? picked.slice(0, 2).join(" ") : [firstPara(about), firstPara(home)].filter(Boolean).join(" ")).slice(0, 500) || tagline;

  const segments: string[] = [];
  const lead = `${home?.description ?? ""} ${firstPara(home)} ${firstPara(about)}`;
  const forMatch = lead.match(/\b(?:built for|designed for|made for|serving|for)\s+([a-z][a-z ,'&-]{3,90}?)(?=[.:;!)]|\s(?:in|with|across|who|that|since|and their|near)\b|$)/i);
  if (forMatch) {
    for (const part of forMatch[1].split(/,|\band\b|&/)) {
      const seg = part.trim().replace(/^(the|whole|entire|all|every|our|your)\s+/i, "").toLowerCase();
      if (seg.length >= 4 && seg.length <= 32 && !/^(you|your|us|our|the|a|an)$/.test(seg)) segments.push(seg);
    }
  }
  const segMap: [string, RegExp][] = [
    ["families", /\bfamil(y|ies)\b/],
    ["local residents", /\b(neighborhood|neighbourhood|local|community)\b/],
    ["small businesses", /\bsmall business(es)?\b/],
    ["businesses", /\b(b2b|enterprise|companies|teams)\b/],
    ["students", /\bstudents?\b/],
    ["patients", /\bpatients?\b/],
    ["homeowners", /\b(homeowners?|your home)\b/],
    ["event hosts", /\b(weddings?|events?|catering)\b/],
    ["freelancers", /\bfreelancers?\b/],
    ["parents and children", /\b(kids|children|toddlers|parents)\b/],
  ];
  for (const [seg, re] of segMap) if (re.test(lower) && !segments.some((x) => x.includes(seg.split(" ")[0]))) segments.push(seg);
  if (!segments.length) segments.push("general public");

  const monthlyPrices = (lower.match(/\$\s?\d+(\.\d{2})?\s?(\/|per)\s?(month|mo|year|yr|user)\b/g) || []).length;
  const softwareLike = /\b(software|saas|platform|app|free trial|per user|sign up|log in)\b/.test(`${home?.description ?? ""} ${firstPara(home)}`.toLowerCase());
  const subscription = (softwareLike && monthlyPrices >= 1) || monthlyPrices >= 3 || /\bsubscription\b/.test(lower);
  const membership = !subscription && /\bmembership (plan|program)\b/.test(lower);
  const retail = pages.some((p) => /\b(menu|shop|products?|store|catalog)\b/i.test(p.url + " " + p.title)) || /\b(menu|in store|in-store|our products)\b/.test(lower);
  const businessModel = subscription
    ? features.ecommerce
      ? "Subscriptions plus online sales"
      : "Subscription plans"
    : features.ecommerce
      ? contact.address
        ? "Online and in-person sales"
        : "Online sales"
      : retail && features.pricingPage
        ? `Retail with prices shown${membership ? ", plus a membership plan" : ""}`
        : features.pricingPage
          ? `Services with published prices${membership ? ", plus a membership plan" : ""}`
          : `Services quoted per customer${membership ? ", plus a membership plan" : ""}`;
  const customerPages = pages.filter((p) => !/career|jobs?|hiring|join/i.test(p.url + " " + p.title));
  const pricePages = customerPages.filter((p) => /pric|menu|plans|rates|fees|insurance/i.test(p.url + " " + p.title));
  const priceSource = (pricePages.length ? pricePages : customerPages).map((p) => p.text).join("\n").replace(/\$\s?\d+(\.\d{2})?\s?(\/|per)\s?(hour|hr)\b/gi, "");
  const priceMatch = priceSource.match(/\$\s?\d{1,5}(,\d{3})?(\.\d{2})?(\s?(\/|per)\s?(month|mo|year|yr|user|hour|hr|session|person))?/g);
  const pricingSummary = priceMatch
    ? `Prices published on the site (e.g. ${[...new Set(priceMatch.map((m) => m.replace(/\s+/g, " ").trim()))].slice(0, 3).join(", ")})`
    : "Prices not published";
  const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
  const sizeHit = lower.match(/\b(?:team of|staff of|a team of)\s+(\d{1,3}|[a-z]+)\b|\b(\d{1,3})\s+(?:staff|employees|team members|people on (?:our|the) team)\b/);
  const sizeNum = sizeHit ? Number(sizeHit[1] ?? sizeHit[2]) || WORDS[sizeHit[1] ?? ""] : undefined;
  const staffMentions = (lower.match(/\bour team\b|\bstaff\b|\bemployees\b/g) || []).length;
  const sizeEstimate = sizeNum
    ? `About ${sizeNum} people (the site says "${sizeHit![0].trim()}")`
    : /franchise|locations across|nationwide|all locations/.test(lower)
      ? "Several locations (the site mentions them)"
      : staffMentions > 2 || features.careersPage
        ? "Not published; the site mentions a team or hiring"
        : "Not published on the site";
  const channels: string[] = [];
  if (contact.phone) channels.push("phone");
  if (contact.email) channels.push("email");
  if (features.contactForm) channels.push("web form");
  if (features.onlineBooking) channels.push("online booking");
  if (features.ecommerce) channels.push("online store");
  if (contact.address) channels.push("walk-in");
  if (!channels.length) channels.push("website");
  const perK = (re: RegExp) => (lower.match(re) || []).length / Math.max(1, lower.length / 1000);
  const casual = perK(/\bwe're\b|\by'all\b|\bfolks\b|\byum\b|\bwe love\b|!/g);
  const formal = perK(/\bpatients?\b|\bclients?\b|\bconsultation\b|\bprofessional\b|\blicensed\b|\bcertified\b|\bdr\.|\battorney\b|\bpolicy\b/g);
  const practical = perK(/\bapp\b|\bsoftware\b|\bdashboard\b|\bsync\b|\bexport\b|\bintegrat|\bpricing\b|\bplans?\b/g);
  // Only label a tone when the wording clearly leans one way; otherwise stay neutral.
  const toneOfVoice =
    lower.length < 1500 ? "Friendly and straightforward" : formal >= 1 && formal >= casual * 1.5 ? "Professional and reassuring" : casual > 1.5 && casual >= formal * 1.5 ? "Warm and casual" : practical >= 1.5 && practical > formal ? "Direct and practical" : "Friendly and straightforward";
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
    sourceIndices: [...new Set([pages.indexOf(home!), about ? pages.indexOf(about) : -1, ...pricePages.slice(0, 1).map((p) => pages.indexOf(p))].filter((i) => i >= 0))],
  };
}
