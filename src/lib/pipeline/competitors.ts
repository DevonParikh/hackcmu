import { z } from "zod";
import { crawlSite, normalizeUrl } from "../ingest/crawl";
import { isDemo, research, structured } from "../llm";
import type { CompanyProfile, Competitor } from "../types";
import { CompetitorSchema, FEATURE_LABELS, FEATURE_KEYS } from "../types";
import { stripTitle } from "./corpus";

const DiscoverySchema = z.object({ competitors: z.array(CompetitorSchema).max(5) });

export async function findCompetitors(opts: {
  companyName: string;
  url: string;
  profile: CompanyProfile;
  providedUrls: string[];
  log: (msg: string) => void;
}): Promise<Competitor[]> {
  const { companyName, url, profile, providedUrls, log } = opts;
  let list: Competitor[] = [];

  if (providedUrls.length) {
    list = providedUrls.map((u) => ({ name: "", url: normalizeUrl(u), why: "Provided by you", offering: "", strengths: [], weaknesses: [] }));
  } else if (isDemo()) {
    log("Competitor discovery needs a Claude API key; add competitor URLs on the start page to compare in demo mode.");
    return [];
  } else {
    log("Searching the web for competitors");
    const notes = await research({
      prompt: `Find 3 to 5 direct competitors of "${companyName}" (${url}). About them: ${profile.tagline}. Customers: ${profile.customerSegments.join(", ")}. Location: ${profile.location ?? "unknown"}.
Prefer competitors serving the same customers in the same area or the same niche online. For each competitor give: official website URL, one line on why it competes, what it offers, two strengths, two weaknesses (things ${companyName} could do better than them or they do better). Cite where you found each fact. Do not include ${companyName} itself.`,
    });
    const parsed = await structured({
      schema: DiscoverySchema,
      effort: "low",
      system: "Extract competitors from research notes into the schema. Only include competitors with a real website URL from the notes. Leave out anything speculative.",
      user: `Company: ${companyName} (${url})\n\nRESEARCH NOTES:\n${notes}`,
    });
    list = parsed.competitors.filter((c) => {
      try {
        return new URL(normalizeUrl(c.url)).host !== new URL(url).host;
      } catch {
        return false;
      }
    });
  }

  const out: Competitor[] = [];
  for (const c of list.slice(0, 5)) {
    try {
      log(`Reading competitor site ${c.url}`);
      const crawl = await crawlSite(c.url, { maxPages: 8 });
      const home = crawl.pages[0];
      const name = c.name || (home ? stripTitle(home.title) : new URL(crawl.rootUrl).host);
      const offering = c.offering || home?.description || (home?.text.split("\n").find((l) => l.length > 60) ?? "").slice(0, 240);
      const has = FEATURE_KEYS.filter((k) => crawl.features[k]).map((k) => FEATURE_LABELS[k]);
      out.push({
        ...c,
        name,
        url: crawl.rootUrl,
        offering,
        strengths: c.strengths.length ? c.strengths : has.slice(0, 3).map((h) => `Has ${h.toLowerCase()}`),
        weaknesses: c.weaknesses,
        features: crawl.features,
        tech: crawl.tech,
      });
    } catch (e) {
      log(`Could not read competitor ${c.url}: ${(e as Error).message}`);
      if (c.name) out.push(c);
    }
  }
  return out;
}
