// lib/features.ts — deterministic features of a site, from the crawl alone. No LLM.
// These are the inputs to the instant estimator (lib/estimator.ts). Order matters: keep FEATURE_NAMES stable.

import type { Source } from "./schemas";

export const FEATURE_NAMES = [
  "pages", "kchars", "thin",
  "hasFaq", "hasHours", "hasPhone", "hasEmail", "hasOnlineBooking", "hasOnlineOrdering", "hasPricing", "hasReviews",
  "revCalled", "revEmail", "revNoReply", "revWaited", "revRefund", "revBooking",
  "indRestaurant", "indSalon", "indMedical", "indFitness", "indTrades", "indRetail",
] as const;
export type FeatureName = typeof FEATURE_NAMES[number];
export type Features = Record<FeatureName, number>;

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;
const has = (re: RegExp, s: string) => (re.test(s) ? 1 : 0);

export function extractFeatures(sources: Source[], thin: boolean): Features {
  const pages = sources.filter(s => s.kind === "page");
  const site = pages.map(s => `${s.title}\n${s.text}`).join("\n").toLowerCase();
  const rev  = sources.filter(s => s.kind === "review").map(s => s.text).join("\n").toLowerCase();
  const titlesUrls = pages.map(s => `${s.title} ${s.url}`).join(" ").toLowerCase();
  const kchars = Math.round(site.length / 1000);

  return {
    pages: pages.length,
    kchars,
    thin: thin ? 1 : 0,
    hasFaq:            has(/\bfaq\b|frequently asked|common questions/, titlesUrls + " " + site),
    hasHours:          has(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[:\-–]?\s*\d{1,2}(:\d{2})?\s*(am|pm)/, site),
    hasPhone:          has(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, site),
    hasEmail:          has(/[\w.+-]+@[\w-]+\.[a-z]{2,}/, site),
    hasOnlineBooking:  has(/book (online|now|an appointment)|schedule online|reserve (online|a table)|calendly|acuity|square appointments|opentable|resy|vagaro|mindbody|booksy/, site),
    hasOnlineOrdering: has(/order online|order now|doordash|ubereats|grubhub|toast|clover|square online|shopify|add to cart/, site),
    hasPricing:        count(/\$\s?\d/g, site) >= 5 ? 1 : 0,
    hasReviews:        rev.length > 0 ? 1 : 0,
    revCalled:         count(/\b(called|phoned|call them|calling)\b/g, rev),
    revEmail:          count(/\bemail(ed|s|ing)?\b/g, rev),
    revNoReply:        count(/no (reply|response|answer)|never (heard|replied|got back)|didn'?t (respond|reply|answer)|nobody (picked|answered)/g, rev),
    revWaited:         count(/\bwait(ed|ing)?\b/g, rev),
    revRefund:         count(/\brefund(ed|s)?\b|charged twice|overcharg/g, rev),
    revBooking:        count(/\b(book(ed|ing)?|appointment|reservation)\b/g, rev),
    indRestaurant:     count(/\b(menu|dish|takeout|delivery|entree|appetizer|catering)\b/g, site) >= 5 ? 1 : 0,
    indSalon:          count(/\b(haircut|stylist|salon|barber|blowout|manicure|lash)\b/g, site) >= 3 ? 1 : 0,
    indMedical:        count(/\b(dentist|dental|clinic|patient|physician|chiropract|therapy)\b/g, site) >= 3 ? 1 : 0,
    indFitness:        count(/\b(gym|yoga|pilates|class schedule|membership|trainer)\b/g, site) >= 3 ? 1 : 0,
    indTrades:         count(/\b(plumb|electric|hvac|roofing|repair|estimate|contractor)\b/g, site) >= 3 ? 1 : 0,
    indRetail:         count(/\b(shop|store|cart|checkout|in stock|shipping)\b/g, site) >= 4 ? 1 : 0,
  };
}
