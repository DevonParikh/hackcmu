import type { CrawlResult } from "../ingest/crawl";
import { jobPages } from "../ingest/crawl";
import type { FrictionSignal } from "../types";

/** Deterministic friction signals derived from the crawl. Every signal carries evidence with a URL. */
export function detectSignals(crawl: CrawlResult, pain: string): FrictionSignal[] {
  const out: FrictionSignal[] = [];
  const { features, contact, pages, rootUrl } = crawl;
  const contactPage = pages.find((p) => /contact/i.test(p.url) || /contact/i.test(p.title)) ?? pages[0];
  const text = pages.map((p) => p.text).join("\n");
  const lower = text.toLowerCase();

  if (!features.liveChat && (contact.email || contact.phone)) {
    out.push({
      id: "support_by_email_only",
      task: "Answering the same customer questions by email and phone",
      who: "Owner or front-desk staff",
      frequency: "Daily",
      evidence: [
        {
          quote: `Only ${[contact.email && "email", contact.phone && "phone"].filter(Boolean).join(" and ")} offered; no chat widget detected`,
          sourceUrl: contactPage?.url ?? rootUrl,
        },
      ],
    });
  }
  if (!features.faqPage) {
    out.push({
      id: "no_faq_page",
      task: "Explaining basics (hours, policies, what's included) one customer at a time",
      who: "Whoever answers the inbox",
      frequency: "Several times a week",
      evidence: [{ quote: `No FAQ page found among ${pages.length} crawled pages`, sourceUrl: rootUrl }],
    });
  }
  const bookingRe = /appointment|reservation|book (a|an|your)|reserve|schedule (a|an|your)|(call|phone|email)( us)? to (order|book|reserve|schedule)|to (order|book|reserve|schedule),? (please )?(call|phone|email)|(confirm|take|place)[a-z ]* (order|booking)s? by phone|orders? by phone/;
  const mentionsBooking = bookingRe.test(lower);
  if (!features.onlineBooking && mentionsBooking) {
    const p = pages.find((pg) => bookingRe.test(pg.text.toLowerCase())) ?? pages[0];
    const m = p?.text.match(/[^.\n]*(appointment|reservation|book|reserve|schedule|order)[^.\n]*/i);
    out.push({
      id: "phone_only_booking",
      task: "Taking orders and bookings by phone or email instead of online",
      who: "Front desk",
      frequency: "Daily",
      evidence: [{ quote: m ? m[0].trim().slice(0, 160) : "Booking mentioned but no online booking tool detected", sourceUrl: p?.url ?? rootUrl }],
    });
  }
  if (!features.contactForm && !features.ecommerce) {
    out.push({
      id: "no_lead_capture",
      task: "Qualifying new inquiries through unstructured emails and calls",
      who: "Owner",
      frequency: "Weekly",
      evidence: [{ quote: "No contact or inquiry form detected on the site", sourceUrl: contactPage?.url ?? rootUrl }],
    });
  }
  const reviewLink = pages.find((p) => /yelp\.com|google\.com\/maps|g\.page|trustpilot|tripadvisor/i.test(p.html));
  if (reviewLink && !features.reviewsShown) {
    out.push({
      id: "reviews_offsite",
      task: "Replying to reviews on Google, Yelp, or similar",
      who: "Owner",
      frequency: "Weekly",
      evidence: [{ quote: "Links to a review site found but no reviews shown on the site", sourceUrl: reviewLink.url }],
    });
  }
  for (const jp of jobPages(pages)) {
    const m = jp.text.match(/[^.\n]*(receptionist|front desk|customer service|customer support|office manager|administrative|scheduler|host)[^.\n]*/i);
    if (m) {
      out.push({
        id: "hiring_front_desk",
        task: "Hiring for roles that spend much of the day answering routine questions",
        who: "Front desk or support staff",
        frequency: "Ongoing",
        evidence: [{ quote: m[0].trim().slice(0, 160), sourceUrl: jp.url }],
      });
      break;
    }
  }
  if (features.ecommerce) {
    const p = pages.find((pg) => /shop|product|store|menu/i.test(pg.url)) ?? pages[0];
    out.push({
      id: "ecommerce_catalog",
      task: "Writing and updating product listings",
      who: "Owner or marketing",
      frequency: "Weekly",
      evidence: [{ quote: "Online store or checkout detected", sourceUrl: p?.url ?? rootUrl }],
    });
  }
  const painLower = pain.toLowerCase();
  if (painLower.trim()) {
    const map: [string, RegExp][] = [
      ["owner_pain_support", /support|question|email|inbox|phone|call/],
      ["owner_pain_leads", /lead|quote|inquir|sales|estimate/],
      ["owner_pain_reviews", /review|reputation|yelp|google/],
      ["owner_pain_booking", /book|appointment|schedul|reserv|order/],
      ["owner_pain_content", /listing|product|descri|content|copy|social/],
      ["owner_pain_training", /train|onboard|staff|employee|new hire/],
    ];
    const ids = map.filter(([, re]) => re.test(painLower)).map(([id]) => id);
    if (!ids.length) ids.push("owner_pain_other");
    // One signal; templates match on any of the joined ids.
    out.push({
      id: ids.join("+"),
      task: pain.trim().slice(0, 200),
      who: "Reported by the owner",
      frequency: "As described",
      evidence: [{ quote: pain.trim().slice(0, 200), sourceUrl: "user-input" }],
    });
  }
  return out;
}
