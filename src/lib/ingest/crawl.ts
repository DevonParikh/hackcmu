import * as cheerio from "cheerio";
import type { Brand, Contact, FeatureChecklist, FeatureKey } from "../types";

export interface CrawledPage {
  url: string;
  title: string;
  description: string;
  text: string;
  html: string;
  links: string[];
  status: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  tech: string[];
  brand: Brand;
  contact: Contact;
  features: FeatureChecklist;
  rootUrl: string;
}

const PRIORITY = [
  "pricing", "price", "plans", "about", "faq", "help", "support", "contact", "services", "service",
  "product", "products", "menu", "shop", "book", "booking", "appointment", "schedule", "careers",
  "jobs", "team", "docs", "blog", "news", "reviews", "testimonials", "hours", "location", "policy",
];
const SKIP = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|mp4|mp3|css|js|woff2?|ttf)(\?|$)/i;
const UA = "Mozilla/5.0 (compatible; TailorBot/0.1; +https://github.com/DevonParikh/hackcmu)";

export function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  u.hash = "";
  return u.toString();
}

async function fetchPage(url: string, timeoutMs = 10000): Promise<{ status: number; html: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    });
    const type = res.headers.get("content-type") || "";
    if (!type.includes("html") && !type.includes("text/plain") && type !== "") {
      return { status: res.status, html: "", finalUrl: res.url || url };
    }
    const html = await res.text();
    return { status: res.status, html: html.slice(0, 1_500_000), finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s([.,;:!?])/g, "$1").trim();
}

export function extractPage(url: string, html: string, status: number): CrawledPage {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, template").remove();
  const title = cleanText($("title").first().text() || $("h1").first().text() || url);
  const description = cleanText($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "");
  const root = $("main").length ? $("main") : $("body");
  const parts: string[] = [];
  root.find("h1, h2, h3, h4, p, li, td, th, dt, dd, blockquote, address, figcaption, label, summary").each((_, el) => {
    const t = cleanText($(el).text());
    if (t.length > 1) parts.push(t);
  });
  let text = parts.join("\n");
  if (text.length < 200) text = cleanText(root.text());
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const abs = new URL(href, url);
      abs.hash = "";
      links.push(abs.toString());
    } catch {
      /* ignore */
    }
  });
  return { url, title, description, text: text.slice(0, 20000), html, links, status };
}

function scoreLink(u: URL): number {
  const p = (u.pathname + u.search).toLowerCase();
  let s = 0;
  for (const k of PRIORITY) if (p.includes(k)) s += 3;
  s -= Math.min(p.split("/").length, 6); // shallower is better
  if (u.search) s -= 2;
  return s;
}

export async function crawlSite(
  inputUrl: string,
  opts: { maxPages?: number; log?: (msg: string) => void } = {},
): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 25;
  const log = opts.log ?? (() => {});
  const rootUrl = normalizeUrl(inputUrl);
  const root = new URL(rootUrl);
  const seen = new Set<string>([rootUrl]);
  const queue: string[] = [rootUrl];
  const pages: CrawledPage[] = [];

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!;
    try {
      const { status, html, finalUrl } = await fetchPage(url);
      if (!html) continue;
      const page = extractPage(finalUrl, html, status);
      if (status >= 400) {
        log(`Skipped ${url} (HTTP ${status})`);
        continue;
      }
      pages.push(page);
      log(`Read ${page.title || url}`);
      const candidates: URL[] = [];
      for (const l of page.links) {
        try {
          const u = new URL(l);
          if (u.host !== root.host || !/^https?:$/.test(u.protocol)) continue;
          if (SKIP.test(u.pathname)) continue;
          const key = u.toString().replace(/\/$/, "");
          if (seen.has(key) || seen.has(key + "/")) continue;
          seen.add(key);
          candidates.push(u);
        } catch {
          /* ignore */
        }
      }
      candidates.sort((a, b) => scoreLink(b) - scoreLink(a));
      for (const c of candidates) queue.push(c.toString());
      queue.sort((a, b) => scoreLink(new URL(b)) - scoreLink(new URL(a)));
    } catch (e) {
      log(`Could not read ${url}: ${(e as Error).message}`);
    }
  }

  const allHtml = pages.map((p) => p.html).join("\n");
  const tech = detectTech(allHtml);
  const brand = await detectBrand(pages, rootUrl);
  const contact = detectContact(pages);
  const features = detectFeatures(pages, tech);
  return { pages, tech, brand, contact, features, rootUrl };
}

// ---------- Tech stack ----------

const TECH: [string, RegExp][] = [
  ["Shopify", /cdn\.shopify\.com|Shopify\.theme|myshopify/i],
  ["Wix", /wix\.com|wixstatic|_wixCssModules/i],
  ["Squarespace", /squarespace\.com|static1\.squarespace/i],
  ["WordPress", /wp-content|wp-includes|wp-json/i],
  ["Webflow", /webflow\.(com|io)|w-webflow-badge/i],
  ["Next.js", /__NEXT_DATA__|\/_next\/static/i],
  ["React", /data-reactroot|react-dom|__reactContainer/i],
  ["Stripe", /js\.stripe\.com|checkout\.stripe/i],
  ["Square", /squareup\.com|square\.site|squarecdn/i],
  ["Intercom", /widget\.intercom\.io|intercomcdn/i],
  ["Drift", /js\.driftt\.com/i],
  ["Crisp", /client\.crisp\.chat/i],
  ["Tawk.to", /embed\.tawk\.to/i],
  ["Zendesk", /zdassets\.com|zendesk\.com\/embeddable/i],
  ["HubSpot", /js\.hs-scripts\.com|hubspot\.com/i],
  ["Calendly", /calendly\.com/i],
  ["Acuity Scheduling", /acuityscheduling\.com/i],
  ["Mindbody", /mindbodyonline\.com/i],
  ["Square Appointments", /squareup\.com\/appointments/i],
  ["OpenTable", /opentable\.com/i],
  ["Resy", /resy\.com/i],
  ["Toast", /toasttab\.com/i],
  ["Mailchimp", /mailchimp\.com|list-manage\.com|chimpstatic/i],
  ["Klaviyo", /klaviyo\.com/i],
  ["Google Analytics", /googletagmanager\.com\/gtag|google-analytics\.com|gtag\(/i],
  ["Google Tag Manager", /googletagmanager\.com\/gtm/i],
  ["Meta Pixel", /connect\.facebook\.net\/.*fbevents/i],
  ["Cloudflare", /cdnjs\.cloudflare\.com|cloudflareinsights/i],
  ["jQuery", /jquery(\.min)?\.js/i],
  ["Bootstrap", /bootstrap(\.min)?\.(css|js)/i],
  ["Tailwind CSS", /tailwindcss|cdn\.tailwindcss\.com/i],
];

export function detectTech(html: string): string[] {
  return TECH.filter(([, re]) => re.test(html)).map(([name]) => name);
}

// ---------- Brand ----------

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function isBoring(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const light = (max + min) / 2 / 255;
  return sat < 0.18 || light > 0.93 || light < 0.08;
}

export async function detectBrand(pages: CrawledPage[], rootUrl: string): Promise<Brand> {
  const counts = new Map<string, number>();
  const add = (css: string) => {
    for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
      let hex = m[0].toLowerCase();
      if (hex.length === 4) hex = "#" + hex.slice(1).split("").map((c) => c + c).join("");
      if (isBoring(hex)) continue;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  };
  let logoUrl: string | null = null;
  const sheets = new Set<string>();
  for (const p of pages.slice(0, 6)) {
    const $ = cheerio.load(p.html);
    $("style").each((_, el) => add($(el).text()));
    $("[style]").each((_, el) => add($(el).attr("style") || ""));
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        try {
          const u = new URL(href, p.url);
          if (u.host === new URL(rootUrl).host) sheets.add(u.toString());
        } catch {
          /* ignore */
        }
      }
    });
    if (!logoUrl) {
      const img = $('img[src*="logo" i], img[alt*="logo" i], img[class*="logo" i], header img, .logo img, #logo img').first();
      const src = img.attr("src");
      if (src) {
        try {
          logoUrl = new URL(src, p.url).toString();
        } catch {
          /* ignore */
        }
      }
      if (!logoUrl) {
        const icon = $('link[rel*="icon"]').first().attr("href");
        if (icon) {
          try {
            logoUrl = new URL(icon, p.url).toString();
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  for (const s of [...sheets].slice(0, 3)) {
    try {
      const { html } = await fetchPage(s, 6000);
      add(html);
    } catch {
      /* ignore */
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  return { primary: sorted[0] ?? "#0e6b60", secondary: sorted[1] ?? "#b9791e", logoUrl };
}

// ---------- Contact ----------

export function detectContact(pages: CrawledPage[]): Contact {
  let email: string | null = null, phone: string | null = null, address: string | null = null;
  for (const p of pages) {
    const $ = cheerio.load(p.html);
    if (!email) {
      const m = $('a[href^="mailto:"]').first().attr("href");
      if (m) email = m.replace(/^mailto:/i, "").split("?")[0];
      else {
        const t = p.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
        if (t) email = t[0];
      }
    }
    if (!phone) {
      const m = $('a[href^="tel:"]').first().attr("href");
      if (m) phone = m.replace(/^tel:/i, "");
      else {
        const t = p.text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
        if (t) phone = t[0].trim();
      }
    }
    if (!address) {
      const a = cleanText($("address").first().text());
      if (a) address = a;
      else {
        const t = p.text.match(/\d{1,5}\s+[A-Z][\w.]*(\s+[A-Z][\w.]*)*\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way)\b[^\n]{0,60}/);
        if (t) address = cleanText(t[0]);
      }
    }
  }
  return { email, phone, address };
}

// ---------- Feature checklist ----------

export function detectFeatures(pages: CrawledPage[], tech: string[]): FeatureChecklist {
  const html = pages.map((p) => p.html).join("\n");
  const text = pages.map((p) => p.text).join("\n").toLowerCase();
  const paths = pages.map((p) => new URL(p.url).pathname.toLowerCase());
  const has = (re: RegExp) => re.test(html);
  const pathHas = (re: RegExp) => paths.some((p) => re.test(p));
  const f: Record<FeatureKey, boolean> = {
    onlineBooking:
      tech.some((t) => /Calendly|Acuity|Mindbody|Square Appointments|OpenTable|Resy|Toast/.test(t)) ||
      pathHas(/book|appointment|reserv|schedule/) ||
      /book (online|now|an appointment)|reserve (online|a table)|schedule online/.test(text),
    liveChat: tech.some((t) => /Intercom|Drift|Crisp|Tawk|Zendesk|HubSpot/.test(t)) || has(/live ?chat|chat-widget|chat with us/i),
    faqPage: pathHas(/faq|help|questions/) || /frequently asked questions/.test(text),
    pricingPage: pathHas(/pric|plans|rates|menu/) || /\$\s?\d{1,5}(\.\d{2})?/.test(text),
    contactForm: has(/<form[^>]*>[\s\S]*?(name|email|message)[\s\S]*?<\/form>/i),
    reviewsShown: /testimonial|reviews?|what (our )?(customers|clients) say|★|stars?/.test(text) && /review|testimonial/.test(html.toLowerCase()),
    blog: pathHas(/blog|news|articles|journal/),
    socialLinks: has(/instagram\.com|facebook\.com|tiktok\.com|linkedin\.com|twitter\.com|x\.com\//i),
    emailCapture: has(/newsletter|subscribe|type="email"/i),
    ecommerce: tech.some((t) => /Shopify|Stripe|Square$|Toast/.test(t)) || has(/add to cart|checkout|order online/i),
    careersPage: pathHas(/career|jobs|hiring|join/) || /we'?re hiring|now hiring|join our team/.test(text),
    mobileReady: has(/<meta[^>]+name=["']viewport["']/i),
  };
  return f;
}

/** Pages whose path or title suggests a job posting. */
export function jobPages(pages: CrawledPage[]): CrawledPage[] {
  return pages.filter((p) => /career|jobs|hiring|join/.test(p.url.toLowerCase()) || /we'?re hiring|now hiring|join our team/i.test(p.text));
}
