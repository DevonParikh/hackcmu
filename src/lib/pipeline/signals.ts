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

  if (!features.liveChat && !features.faqPage && (contact.email || contact.phone)) {
    const channels = [contact.email && "email", contact.phone && "phone"].filter(Boolean).join(" and ");
    out.push({
      id: "support_by_email_only",
      task: `Answering the same customer questions by ${channels}`,
      who: contact.phone ? "Whoever answers the phone and inbox" : "Whoever answers the inbox",
      frequency: "Every time a customer asks",
      evidence: [
        {
          quote: `Only ${[contact.email && "email", contact.phone && "phone"].filter(Boolean).join(" and ")} offered; no chat or self-serve help found`,
          sourceUrl: contactPage?.url ?? rootUrl,
          observed: true,
        },
      ],
    });
  }
  if (!features.faqPage) {
    out.push({
      id: "no_faq_page",
      task: "Explaining basics (hours, policies, what's included) one customer at a time",
      who: "Whoever answers the inbox",
      frequency: "Every time a customer asks",
      evidence: [{ quote: `No FAQ page found among the ${pages.length} pages we read`, sourceUrl: rootUrl, observed: true }],
    });
  }
  // Only real "contact us to book/order" constructions count; "no appointment necessary" must not.
  const bookingRe = /\b((call|phone|email|text)( us)?( at [^.]{0,40})? to (order|book|reserve|schedule|make an appointment)|to (order|book|reserve|schedule|make an appointment),? (please )?(call|phone|email|text)|(appointments?|reservations?|bookings?|orders?) (are )?(taken |made |only )?(by|over the) phone|call (us )?(for|to make|to schedule|to book) (an appointment|a reservation|a booking|your appointment)|we confirm (every |all )?(order|appointment|booking)s? by phone|book (a|an|your) [a-z ]{0,30}by (phone|calling)|reserve (a|your) [a-z ]{0,30}by (phone|calling))\b/i;
  const negatesBooking = /\b(no appointments? (necessary|needed|required)|walk-?ins? (welcome|only)|no reservations?|first come)\b/i;
  // Prefer the sentence that tells customers how to book ("to schedule, call us") over confirmation details.
  const howToBook = /\b(to (order|book|reserve|schedule|make an appointment)( an? [a-z ]{0,25})?,? (please )?(call|phone|email|text)|(call|phone|email|text)( us)?( at [^.]{0,40})? to (order|book|reserve|schedule|make an appointment))\b/i;
  const sentencesOf = (pg: { text: string }) => pg.text.split(/(?<=[.!?])\s+|\n+/);
  const bookingHit =
    pages.map((pg) => ({ pg, sentence: sentencesOf(pg).find((x) => howToBook.test(x) && !negatesBooking.test(x)) })).find((h) => h.sentence) ??
    pages.map((pg) => ({ pg, sentence: sentencesOf(pg).find((x) => bookingRe.test(x) && !negatesBooking.test(x)) })).find((h) => h.sentence);
  if (!features.onlineBooking && bookingHit?.sentence) {
    out.push({
      id: "phone_only_booking",
      task: "Taking orders and bookings by phone or email instead of online",
      who: "Whoever answers the phone",
      frequency: "Every order or booking",
      evidence: [{ quote: bookingHit.sentence.trim().slice(0, 180), sourceUrl: bookingHit.pg.url }],
    });
  }
  if (!features.contactForm && !features.ecommerce) {
    out.push({
      id: "no_lead_capture",
      task: "Qualifying new inquiries through unstructured emails and calls",
      who: "Owner",
      frequency: "Every new inquiry",
      evidence: [{ quote: "No contact or inquiry form found on the site", sourceUrl: contactPage?.url ?? rootUrl, observed: true }],
    });
  }
  const reviewLink = pages.find((p) => /yelp\.com|google\.com\/maps|g\.page|trustpilot|tripadvisor|facebook\.com\/[^"']+\/reviews/i.test(p.html) || /reviews? on (google|yelp|facebook)/i.test(p.text));
  if (reviewLink && !features.reviewsShown) {
    out.push({
      id: "reviews_offsite",
      task: "Replying to reviews on Google, Yelp, or similar",
      who: "Owner",
      frequency: "Every review",
      evidence: [{ quote: "Links to a review site, but no reviews shown on the site itself", sourceUrl: reviewLink.url, observed: true }],
    });
  }
  for (const jp of jobPages(pages)) {
    const sentences = jp.text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 20);
    const hiringWords = /hiring|open role|open position|position|join our team|looking for|we need|apply/i;
    const frontDesk = /\b(receptionist|front desk|office manager|administrative assistant|scheduler|counter (staff|associate|help)|host(ess)?)\b/i;
    const support = /\b(customer service|customer support|support specialist|support associate|answer(ing)? (the )?(phone|phones|calls|emails)|client care)\b/i;
    const contactVerb = /\b(greet|answer|calls?|phones?|emails?|customers?|patients?|clients?|schedul\w*|book\w*|inquir\w*)\b/i;
    const pick = (role: RegExp) => sentences.find((x) => hiringWords.test(x) && role.test(x) && contactVerb.test(x)) ?? sentences.find((x) => role.test(x) && contactVerb.test(x) && /\b(we're|we are|part-time|full-time|hour|\$)/i.test(x));
    const deskSentence = pick(frontDesk);
    const supportCandidate = pick(support);
    // One sentence should produce one signal: a front-desk role that also answers phones is a front-desk signal.
    const supportSentence = supportCandidate && supportCandidate !== deskSentence ? supportCandidate : undefined;
    if (supportSentence && !out.some((o) => o.id === "hiring_support")) {
      out.push({
        id: "hiring_support",
        task: "Hiring people to answer routine customer questions",
        who: "Customer support staff",
        frequency: "Ongoing",
        evidence: [{ quote: supportSentence.slice(0, 180), sourceUrl: jp.url }],
      });
    }
    if (deskSentence && !out.some((o) => o.id === "hiring_front_desk")) {
      out.push({
        id: "hiring_front_desk",
        task: "Hiring front-desk staff to take calls and schedule by hand",
        who: "Front desk",
        frequency: "Ongoing",
        evidence: [{ quote: deskSentence.slice(0, 180), sourceUrl: jp.url }],
      });
    }
  }
  if (features.ecommerce) {
    const p = pages.find((pg) => /shop|product|store|menu/i.test(pg.url)) ?? pages[0];
    out.push({
      id: "ecommerce_catalog",
      task: "Writing and updating product listings",
      who: "Owner or marketing",
      frequency: "Every new product",
      evidence: [{ quote: "Online store or checkout found on the site", sourceUrl: p?.url ?? rootUrl, observed: true }],
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
