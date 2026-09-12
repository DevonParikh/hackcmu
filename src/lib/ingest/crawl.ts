import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Brand, Contact, FeatureChecklist, FeatureKey } from "../types";

export interface CrawledPage {
  url: string;
  title: string;
  description: string;
  /** Main content, newline-separated blocks. Used for the knowledge base and profile. */
  text: string;
  /** Whole-page text including header and footer. Used for contact and feature detection. */
  fullText: string;
  html: string;
  links: string[];
  status: number;
  lang: string;
  metaRefresh: string | null;
}

export interface CrawlResult {
  pages: CrawledPage[];
  tech: string[];
  brand: Brand;
  contact: Contact;
  features: FeatureChecklist;
  rootUrl: string;
  /** Hosts the site links or redirects out to (ordering platforms, booking vendors). */
  externalHosts: string[];
  skipped: number;
}

const PRIORITY = [
  "pricing", "price", "prices", "plans", "rates", "fees", "about", "faq", "faqs", "help", "support", "contact",
  "services", "service", "product", "products", "menu", "shop", "book", "booking", "appointment", "appointments",
  "schedule", "careers", "jobs", "team", "docs", "blog", "news", "reviews", "testimonials", "hours", "location", "policy", "policies",
];
const SKIP_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|gz|mp4|mp3|mov|css|js|mjs|json|xml|woff2?|ttf|eot|txt)$/i;
const UA = "Mozilla/5.0 (compatible; TailorBot/0.2; +https://github.com/DevonParikh/hackcmu)";
const PAGE_TIMEOUT_MS = 10_000;
const CRAWL_BUDGET_MS = 75_000;
const CONCURRENCY = 3;
const MAX_REDIRECTS = 5;

// ---------- URLs ----------

export function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https addresses are supported");
  if (u.username || u.password) throw new Error("Addresses with a username or password are not supported");
  if (!u.hostname.includes(".") && !isIP(u.hostname) && u.hostname !== "localhost") throw new Error("That does not look like a website address");
  u.hash = "";
  return u.toString();
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** Canonical identity of a page: host without www, lowercased path, no index file, no query, no hash. */
function canonicalKey(u: URL): string {
  const path = u.pathname.toLowerCase().replace(/\/index\.(html?|php|aspx?)$/, "/").replace(/\/+$/, "") || "/";
  return `${bareHost(u.host)}${path}`;
}

function scoreLink(u: URL): number {
  const segs = u.pathname.toLowerCase().split("/").filter(Boolean);
  let s = 0;
  for (const seg of segs) if (PRIORITY.includes(seg.replace(/\.(html?|php)$/, ""))) s += 3;
  s -= Math.min(segs.length, 6);
  if (u.search) s -= 2;
  return s;
}

// ---------- Private-network guard ----------

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" ) return true;
    if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  return (
    p[0] === 10 || p[0] === 127 || p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}

/** Refuses loopback, private, and link-local targets unless explicitly allowed (local development). */
async function assertPublicHost(host: string): Promise<void> {
  if (process.env.TAILOR_ALLOW_PRIVATE_URLS === "1") return;
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) throw new Error("Private addresses are not allowed");
  if (isIP(h)) {
    if (isPrivateIp(h)) throw new Error("Private addresses are not allowed");
    return;
  }
  const addrs = await lookup(h, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Could not find the website ${host}`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("Private addresses are not allowed");
}

// ---------- Fetching ----------

interface Fetched {
  status: number;
  body: string | null;
  finalUrl: string;
  contentType: string;
}

function decodeBody(buf: ArrayBuffer, contentType: string): string {
  let charset = (contentType.match(/charset=["']?([\w-]+)/i)?.[1] || "").toLowerCase();
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || "").toLowerCase();
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

/** Fetches a URL with manual redirects (each hop checked), a timeout, and charset-aware decoding. */
async function fetchRaw(url: string, accept: RegExp, timeoutMs = PAGE_TIMEOUT_MS): Promise<Fetched> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    await assertPublicHost(u.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(current, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/css;q=0.8,*/*;q=0.5", "accept-language": "en,*;q=0.5" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { status: res.status, body: null, finalUrl: current, contentType: "" };
        current = new URL(loc, current).toString();
        continue;
      }
      const contentType = res.headers.get("content-type") || "";
      if (!accept.test(contentType.split(";")[0].trim().toLowerCase())) {
        return { status: res.status, body: null, finalUrl: current, contentType };
      }
      const buf = await res.arrayBuffer();
      const capped = buf.byteLength > 2_000_000 ? buf.slice(0, 2_000_000) : buf;
      return { status: res.status, body: decodeBody(capped, contentType), finalUrl: current, contentType };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}

/** Turns undici's "fetch failed" into something an owner can act on. */
export function explainFetchError(e: Error): string {
  if (e.name === "AbortError") return "it took too long to respond";
  const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code || "";
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return "the address could not be found";
  if (/ECONNREFUSED/.test(code)) return "the site refused the connection";
  if (/ECONNRESET|EPIPE/.test(code)) return "the connection was cut off";
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(cause?.message || "")) return "its security certificate could not be verified";
  return e.message === "fetch failed" ? cause?.message || "the site did not respond" : e.message;
}

const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)$/;
const CSS_TYPES = /^text\/css$/;

// ---------- Page extraction ----------

const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, blockquote, address, figcaption, label, summary, div, section, article, header, footer, nav, aside, tr, pre, main";

function linesOf(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").replace(/\s([.,;:!?])/g, "$1").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

export function extractPage(url: string, html: string, status: number): CrawledPage {
  const $ = cheerio.load(html);
  const lang = ($("html").attr("lang") || "").toLowerCase().slice(0, 2);
  const refresh = $('meta[http-equiv="refresh" i]').attr("content") || "";
  const refreshUrl = refresh.match(/url\s*=\s*['"]?([^'"\s;]+)/i)?.[1];
  let metaRefresh: string | null = null;
  if (refreshUrl) {
    try {
      metaRefresh = new URL(refreshUrl, url).toString();
    } catch {
      /* ignore */
    }
  }
  $("script, style, noscript, svg, iframe, template, [aria-hidden='true']").remove();
  $("br").replaceWith("\n");
  $(BLOCKS).each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  const title = ($("title").first().text() || $("h1").first().text() || url).replace(/\s+/g, " ").trim();
  const description = ($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "").replace(/\s+/g, " ").trim();
  const fullText = linesOf($("body").text());
  const mainRoot = $("main").length ? $("main") : $("body").clone().find("header, footer, nav, aside").remove().end();
  let text = linesOf(mainRoot.text());
  if (text.length < 200) text = fullText;
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || /^(mailto|tel|javascript|sms):/i.test(href)) return;
    try {
      const abs = new URL(href, url);
      abs.hash = "";
      links.push(abs.toString());
    } catch {
      /* ignore */
    }
  });
  return { url, title, description, text: text.slice(0, 20000), fullText: fullText.slice(0, 40000), html, links, status, lang, metaRefresh };
}

// ---------- Crawl ----------

export async function crawlSite(inputUrl: string, opts: { maxPages?: number; log?: (msg: string) => void } = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 25;
  const log = opts.log ?? (() => {});
  let rootUrl = normalizeUrl(inputUrl);
  const hosts = new Set<string>([bareHost(new URL(rootUrl).host)]);
  const seen = new Set<string>([canonicalKey(new URL(rootUrl))]);
  const queue: string[] = [rootUrl];
  const pages: CrawledPage[] = [];
  const externalHosts = new Set<string>();
  let skipped = 0;
  const deadline = Date.now() + CRAWL_BUDGET_MS;
  let inFlight = 0;
  let rootDone = false;

  const enqueue = (u: URL, front = false) => {
    if (!/^https?:$/.test(u.protocol)) return;
    if (!hosts.has(bareHost(u.host))) {
      if (u.host && bareHost(u.host) !== bareHost(new URL(rootUrl).host)) externalHosts.add(bareHost(u.host));
      return;
    }
    if (SKIP_EXT.test(u.pathname)) return;
    const key = canonicalKey(u);
    if (seen.has(key)) return;
    seen.add(key);
    u.search = "";
    u.hash = "";
    if (front) queue.unshift(u.toString());
    else queue.push(u.toString());
  };

  const visit = async (url: string) => {
    try {
      const { status, body, finalUrl, contentType } = await fetchRaw(url, HTML_TYPES);
      const fu = new URL(finalUrl);
      if (pages.length === 0 && !rootDone) {
        // The site may redirect (http->https, apex->www, or a new domain). Follow it as the canonical root.
        hosts.add(bareHost(fu.host));
        rootUrl = new URL("/", finalUrl).toString();
        rootDone = true;
      } else if (!hosts.has(bareHost(fu.host))) {
        externalHosts.add(bareHost(fu.host));
        log(`${url} sends visitors to ${fu.host}; not counted as part of the site`);
        return;
      }
      if (status >= 400) {
        skipped++;
        log(`Skipped ${url} (HTTP ${status})`);
        return;
      }
      if (body === null) {
        skipped++;
        if (contentType) log(`Skipped ${url} (${contentType.split(";")[0]})`);
        return;
      }
      const page = extractPage(finalUrl, body, status);
      const key = canonicalKey(fu);
      if (pages.some((p) => canonicalKey(new URL(p.url)) === key)) return;
      seen.add(key);
      if (pages.length >= maxPages) return;
      pages.push(page);
      log(`Read ${page.title || finalUrl}`);
      if (page.metaRefresh && page.text.length < 80) {
        try {
          enqueue(new URL(page.metaRefresh), true);
        } catch {
          /* ignore */
        }
      }
      const candidates: URL[] = [];
      for (const l of page.links) {
        try {
          candidates.push(new URL(l));
        } catch {
          /* ignore */
        }
      }
      candidates.sort((a, b) => scoreLink(b) - scoreLink(a));
      for (const c of candidates) enqueue(c);
      queue.sort((a, b) => scoreLink(new URL(b)) - scoreLink(new URL(a)));
    } catch (e) {
      skipped++;
      log(`Could not read ${url}: ${explainFetchError(e as Error)}`);
    }
  };

  // Root first (it decides the canonical host), then a small pool.
  const typedScheme = /^https?:\/\//i.test(inputUrl.trim());
  await visit(queue.shift()!);
  if (!pages.length && !typedScheme && rootUrl.startsWith("https://")) {
    // Older builder sites are sometimes http-only; try once without TLS when the owner typed no scheme.
    const httpUrl = rootUrl.replace(/^https:/, "http:");
    log("Trying the address over http instead of https");
    rootUrl = httpUrl;
    seen.add(canonicalKey(new URL(httpUrl)));
    await visit(httpUrl);
  }
  if (!pages.length && new URL(rootUrl).pathname !== "/") {
    const home = new URL("/", rootUrl).toString();
    log("That page was not readable; starting from the home page instead");
    seen.add(canonicalKey(new URL(home)));
    await visit(home);
  }
  await new Promise<void>((resolve) => {
    const pump = () => {
      while (inFlight < CONCURRENCY && queue.length && pages.length < maxPages && Date.now() < deadline) {
        const next = queue.shift()!;
        inFlight++;
        visit(next).finally(() => {
          inFlight--;
          pump();
        });
      }
      if (inFlight === 0) resolve();
    };
    pump();
  });
  if (queue.length && (pages.length >= maxPages || Date.now() >= deadline)) {
    log(pages.length >= maxPages ? `Stopped at ${maxPages} pages (${queue.length} more not read)` : `Stopped after ${Math.round(CRAWL_BUDGET_MS / 1000)}s (${queue.length} pages not read)`);
  }

  const tech = detectTech(pages);
  const brand = await detectBrand(pages, rootUrl);
  const contact = detectContact(pages, rootUrl);
  const features = detectFeatures(pages, tech);
  return { pages, tech, brand, contact, features, rootUrl, externalHosts: [...externalHosts], skipped };
}

// ---------- Tech stack ----------

const TECH: [string, RegExp][] = [
  ["Shopify", /cdn\.shopify\.com|myshopify\.com|Shopify\.theme/i],
  ["WooCommerce", /woocommerce/i],
  ["BigCommerce", /bigcommerce\.com/i],
  ["Wix", /static\.parastorage\.com|wixstatic\.com|wix\.com\/.*\.js|_wixCssModules/i],
  ["Squarespace", /static1?\.squarespace\.com|squarespace-cdn/i],
  ["WordPress", /wp-content|wp-includes|wp-json|generator[^>]*WordPress/i],
  ["Webflow", /webflow\.(com|io)|w-webflow-badge/i],
  ["Next.js", /__NEXT_DATA__|\/_next\/static/i],
  ["React", /data-reactroot|react-dom|__reactContainer/i],
  ["Stripe", /js\.stripe\.com|checkout\.stripe\.com/i],
  ["Square", /squareup\.com|square\.site|squarecdn\.com/i],
  ["Intercom", /widget\.intercom\.io|intercomcdn/i],
  ["Drift", /js\.driftt\.com/i],
  ["Crisp", /client\.crisp\.chat/i],
  ["Tawk.to", /embed\.tawk\.to/i],
  ["Tidio", /code\.tidio\.co/i],
  ["LiveChat", /cdn\.livechatinc\.com/i],
  ["Olark", /static\.olark\.com/i],
  ["Freshchat", /wchat\.freshchat\.com/i],
  ["Zendesk", /zdassets\.com|zendesk\.com\/embeddable/i],
  ["HubSpot Chat", /js\.usemessages\.com|hubspot-messages-iframe/i],
  ["HubSpot", /js\.hs-scripts\.com|js\.hsforms\.net|hs-analytics/i],
  ["Calendly", /calendly\.com/i],
  ["Acuity Scheduling", /acuityscheduling\.com/i],
  ["Mindbody", /mindbodyonline\.com/i],
  ["Square Appointments", /squareup\.com\/appointments/i],
  ["Booksy", /booksy\.com/i],
  ["Vagaro", /vagaro\.com/i],
  ["Fresha", /fresha\.com/i],
  ["Zocdoc", /zocdoc\.com/i],
  ["OpenTable", /opentable\.com/i],
  ["Resy", /resy\.com/i],
  ["Tock", /exploretock\.com/i],
  ["Toast", /toasttab\.com/i],
  ["DoorDash", /doordash\.com/i],
  ["Mailchimp", /list-manage\.com|chimpstatic\.com|mailchimp\.com/i],
  ["Klaviyo", /klaviyo\.com/i],
  ["Google Analytics", /googletagmanager\.com\/gtag|google-analytics\.com|gtag\(/i],
  ["Google Tag Manager", /googletagmanager\.com\/gtm/i],
  ["Meta Pixel", /connect\.facebook\.net\/[^"']*fbevents/i],
  ["Cloudflare", /cloudflareinsights\.com|\/cdn-cgi\//i],
  ["jQuery", /jquery[-.\d]*(\.min)?\.js/i],
  ["Bootstrap", /bootstrap[.\w-]*\.(css|js)/i],
  ["Tailwind CSS", /cdn\.tailwindcss\.com|tailwindcss/i],
];

/** Runs vendor patterns over asset references and inline scripts only, never over visible prose. */
export function detectTech(pages: CrawledPage[]): string[] {
  const assets: string[] = [];
  for (const p of pages) {
    const html = p.html;
    for (const m of html.matchAll(/<(?:script|link|iframe|img)\b[^>]*?(?:src|href)=["']([^"']+)["']/gi)) assets.push(m[1]);
    for (const m of html.matchAll(/<meta\b[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/gi)) assets.push("generator " + m[1]);
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]{0,4000}?)<\/script>/gi)) assets.push(m[1]);
    for (const m of html.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["']/gi)) assets.push("link " + m[1]);
    for (const m of html.matchAll(/class=["']([^"']*)["']/gi)) if (/woocommerce|w-webflow|_wix/i.test(m[1])) assets.push("class " + m[1]);
    if (/__NEXT_DATA__|data-reactroot/.test(html)) assets.push("marker " + (/__NEXT_DATA__/.test(html) ? "__NEXT_DATA__" : "data-reactroot"));
  }
  const hay = assets.join("\n");
  const found = TECH.filter(([, re]) => re.test(hay)).map(([name]) => name);
  return found.filter((t) => !(t === "HubSpot" && found.includes("HubSpot Chat")));
}

// ---------- Brand ----------

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
}
function isBoring(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const light = (max + min) / 2 / 255;
  return sat < 0.18 || light > 0.93 || light < 0.08;
}
function collectColors(css: string, counts: Map<string, number>) {
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let hex = m[0].toLowerCase();
    if (hex.length === 4) hex = "#" + hex.slice(1).split("").map((c) => c + c).join("");
    if (!isBoring(hex)) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  for (const m of css.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) {
    const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!isBoring(hex)) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
}

function pickLogo(pages: CrawledPage[]): string | null {
  let best: { url: string; score: number } | null = null;
  for (const p of pages.slice(0, 4)) {
    const $ = cheerio.load(p.html);
    $("img").each((_, el) => {
      const $el = $(el);
      const src = $el.attr("data-src") || $el.attr("srcset")?.split(/[\s,]+/)[0] || $el.attr("src") || "";
      if (!src || src.startsWith("data:")) return;
      const alt = ($el.attr("alt") || "").toLowerCase();
      const cls = (($el.attr("class") || "") + " " + ($el.attr("id") || "")).toLowerCase();
      const hay = `${src.toLowerCase()} ${alt} ${cls}`;
      let score = 0;
      if (/logo|brand/.test(hay)) score += 3;
      if ($el.closest('a[href="/"], a[href="./"], a[href$="//"], a[href="index.html"]').length) score += 2;
      if ($el.closest("header, nav, .header, #header, .navbar").length) score += 1;
      if (/yelp|google|facebook|instagram|bbb|badge|award|hero|banner|slide|payment|visa|mastercard|icon-/.test(hay)) score -= 5;
      if (score <= 0) return;
      try {
        const abs = new URL(src, p.url).toString();
        if (!best || score > best.score) best = { url: abs, score };
      } catch {
        /* ignore */
      }
    });
  }
  if (best) return (best as { url: string }).url;
  for (const p of pages.slice(0, 2)) {
    const $ = cheerio.load(p.html);
    const icon = $('link[rel*="apple-touch-icon"], link[rel*="icon"]').first().attr("href");
    if (icon) {
      try {
        return new URL(icon, p.url).toString();
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

export async function detectBrand(pages: CrawledPage[], rootUrl: string): Promise<Brand> {
  const counts = new Map<string, number>();
  const sheets = new Set<string>();
  for (const p of pages.slice(0, 6)) {
    const $ = cheerio.load(p.html);
    $("style").each((_, el) => collectColors($(el).text(), counts));
    $("[style]").each((_, el) => collectColors($(el).attr("style") || "", counts));
    $('link[rel~="stylesheet"]').each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        sheets.add(new URL(href, p.url).toString());
      } catch {
        /* ignore */
      }
    });
  }
  const rootHost = bareHost(new URL(rootUrl).host);
  const ordered = [...sheets].sort((a, b) => Number(bareHost(new URL(b).host) === rootHost) - Number(bareHost(new URL(a).host) === rootHost));
  for (const s of ordered.slice(0, 4)) {
    try {
      const { body } = await fetchRaw(s, CSS_TYPES, 6000);
      if (body) collectColors(body, counts);
    } catch {
      /* ignore */
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  return { primary: sorted[0] ?? "#0e6b60", secondary: sorted[1] ?? "#b9791e", logoUrl: pickLogo(pages) };
}

// ---------- Contact ----------

const PHONE_RE = /(?<![\d#\w/])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)|(?<![\d#\w/])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?!\d)/g;
const STREET = "(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Square|Sq|Parkway|Pkwy|Highway|Hwy|Terrace|Ter|Circle|Cir|Trail|Trl)";
const ADDRESS_RE = new RegExp(`^\\d{1,5}[A-Za-z]?\\s+[A-Za-z0-9.'-]+(?:\\s+[A-Za-z0-9.'-]+){0,4}\\s+${STREET}\\.?(?:[\\s,]+(?:Suite|Ste|Unit|Floor|Fl|#)\\s*[\\w-]+)?(?:,?\\s+[A-Z][A-Za-z .'-]+,?\\s+[A-Z]{2}\\s+\\d{5}(?:-\\d{4})?)?$`);

export function detectContact(pages: CrawledPage[], rootUrl: string): Contact {
  let email: string | null = null, phone: string | null = null, address: string | null = null;
  const rootHost = bareHost(new URL(rootUrl).host);
  const emails: string[] = [];
  for (const p of pages) {
    const $ = cheerio.load(p.html);
    $('a[href^="mailto:" i]').each((_, el) => {
      const addr = ($(el).attr("href") || "").replace(/^mailto:/i, "").split("?")[0].trim();
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(addr)) emails.push(addr);
    });
    if (!phone) {
      const a = $('a[href^="tel:" i]').first();
      const tel = a.attr("href");
      const visible = a.text().replace(/\s+/g, " ").trim();
      // Show the number the way the site shows it, e.g. (412) 555-0142, not the tel: form.
      if (tel) phone = (/\d{3}.*\d{4}/.test(visible) && visible.length <= 24 ? visible : tel.replace(/^tel:/i, "").replace(/[^\d+()\s.-]/g, "").trim()) || null;
    }
    if (!address) {
      const a = $("address").first().text().replace(/\s+/g, " ").trim();
      if (a && /\d/.test(a) && a.length < 160) address = a;
    }
    if (!address) {
      $('script[type="application/ld+json"]').each((_, el) => {
        if (address) return;
        try {
          const data = JSON.parse($(el).text());
          const find = (o: unknown): string | null => {
            if (!o || typeof o !== "object") return null;
            const rec = o as Record<string, unknown>;
            if (typeof rec.streetAddress === "string") {
              return [rec.streetAddress, rec.addressLocality, rec.addressRegion, rec.postalCode].filter((x) => typeof x === "string").join(", ");
            }
            for (const v of Object.values(rec)) {
              const r = find(v);
              if (r) return r;
            }
            return null;
          };
          address = find(data);
        } catch {
          /* ignore */
        }
      });
    }
  }
  if (emails.length) email = emails.find((e) => e.toLowerCase().endsWith("@" + rootHost)) ?? emails[0];
  const allText = pages.map((p) => p.fullText).join("\n");
  if (!email) {
    const m = allText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (m) email = m[0];
  }
  if (!phone) {
    const candidates = [...allText.matchAll(PHONE_RE)];
    const near = candidates.find((m) => /\b(call|phone|tel|text|dial|reach)\b/i.test(allText.slice(Math.max(0, (m.index ?? 0) - 40), m.index)));
    const pick = near ?? candidates[0];
    if (pick) phone = pick[0].trim();
  }
  if (!address) {
    const lines = allText.split("\n");
    const withZip = lines.find((l) => ADDRESS_RE.test(l.trim()) && /\d{5}/.test(l));
    const any = lines.find((l) => ADDRESS_RE.test(l.trim()));
    address = (withZip ?? any)?.trim() ?? null;
  }
  return { email, phone, address };
}

// ---------- Feature checklist ----------

function segments(p: CrawledPage): string[] {
  return new URL(p.url).pathname.toLowerCase().split("/").filter(Boolean).map((s) => s.replace(/\.(html?|php|aspx?)$/, ""));
}
const SOCIAL_HOSTS = new Set(["instagram.com", "facebook.com", "tiktok.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "pinterest.com", "threads.net"]);

export function detectFeatures(pages: CrawledPage[], tech: string[]): FeatureChecklist {
  const text = pages.map((p) => p.fullText).join("\n");
  const lower = text.toLowerCase();
  const segHas = (re: RegExp) => pages.some((p) => segments(p).some((s) => re.test(s)));
  const titleHas = (re: RegExp) => pages.some((p) => re.test(p.title));
  const hasTech = (re: RegExp) => tech.some((t) => re.test(t));

  let contactForm = false, emailCapture = false, reviewsShown = false, socialLinks = false, mobileReady = false;
  let starGlyphs = 0;
  for (const p of pages) {
    const $ = cheerio.load(p.html);
    if ($('meta[name="viewport" i]').length) mobileReady = true;
    $("form").each((_, form) => {
      const $f = $(form);
      const attrs = `${$f.attr("role") || ""} ${$f.attr("action") || ""} ${$f.attr("class") || ""} ${$f.attr("id") || ""}`.toLowerCase();
      if (/search/.test(attrs) || $f.find('input[type="search" i]').length) return;
      const hasTextarea = $f.find("textarea").length > 0;
      const hasEmail = $f.find('input[type="email" i]').length > 0;
      const hasTel = $f.find('input[type="tel" i]').length > 0;
      const fieldNames = $f.find("input, textarea")
        .map((_, i) => `${$(i).attr("name") || ""} ${$(i).attr("id") || ""} ${$(i).attr("placeholder") || ""}`)
        .get()
        .join(" ")
        .toLowerCase();
      const contactish = /message|enquir|inquir|comment|question|phone|name/.test(fieldNames);
      if (hasTextarea || hasTel || (hasEmail && contactish)) contactForm = true;
      else if (hasEmail && !hasTextarea) emailCapture = true;
    });
    $('[class*="review" i], [class*="testimonial" i], [id*="review" i], [id*="testimonial" i]').each((_, el) => {
      if ($(el).is("a")) return;
      if ($(el).text().replace(/\s+/g, " ").trim().length >= 40) reviewsShown = true;
    });
    $('script[type="application/ld+json"]').each((_, el) => {
      if (/"@type"\s*:\s*"(Review|AggregateRating)"/.test($(el).text())) reviewsShown = true;
    });
    $("a[href]").each((_, el) => {
      try {
        const u = new URL($(el).attr("href")!, p.url);
        const h = bareHost(u.host);
        if (SOCIAL_HOSTS.has(h) && !(h === "facebook.com" && u.pathname.startsWith("/tr"))) socialLinks = true;
      } catch {
        /* ignore */
      }
    });
    starGlyphs += (p.fullText.match(/★|⭐/g) || []).length;
  }
  if (starGlyphs >= 3 && /["“][^"”]{15,}["”]/.test(text)) reviewsShown = true;
  if (/\b(what (our )?(customers|clients|patients|guests) say|customer reviews|testimonials)\b/i.test(text) && /["“][^"”]{15,}["”]/.test(text)) reviewsShown = true;
  if (hasTech(/Mailchimp|Klaviyo/)) emailCapture = true;

  const pricePage = pages.some((p) => {
    const named = segments(p).some((s) => /^(pricing|prices|price-list|rates|menu|plans|fees|tarifs|precios|preise)$/.test(s)) || /\b(pricing|prices|rates|menu|plans|fees)\b/i.test(p.title);
    const tokens = new Set(p.fullText.match(/\$\s?\d{1,5}(?:,\d{3})?(?:\.\d{2})?/g) || []);
    return named || (tokens.size >= 3 && /\b(per|from|starting at|package|each|month)\b/i.test(p.fullText));
  });

  const f: Record<FeatureKey, boolean> = {
    onlineBooking:
      hasTech(/Calendly|Acuity|Mindbody|Square Appointments|Booksy|Vagaro|Fresha|Zocdoc|OpenTable|Resy|Tock|Toast/) ||
      segHas(/^(book|booking|bookings|book-now|book-online|appointments?|reserve|reservations?|schedule|schedule-online|reservar|reservation)$/) ||
      /\b(book (online|now|an appointment|a table|your (appointment|table|visit))|reserve (online|a table|now|your table)|schedule online)\b/.test(lower),
    liveChat: hasTech(/Intercom|Drift|Crisp|Tawk|Tidio|LiveChat|Olark|Freshchat|Zendesk|HubSpot Chat/) || /live ?chat|chat with us/.test(lower),
    faqPage: segHas(/^(faq|faqs|help-center|helpcenter|questions|preguntas-frecuentes|questions-frequentes|haeufige-fragen|faq-s)$/) || titleHas(/\bfaqs?\b|frequently asked|preguntas frecuentes|questions fréquentes|häufige fragen/i) || /frequently asked questions/.test(lower),
    pricingPage: pricePage,
    contactForm,
    reviewsShown,
    blog: segHas(/^(blog|news|articles|journal|posts|insights|stories)$/),
    socialLinks,
    emailCapture,
    ecommerce:
      hasTech(/Shopify|WooCommerce|BigCommerce|Toast/) ||
      segHas(/^(cart|checkout|collections|products|order-online|store)$/) ||
      /\b(add to cart|buy now|order online|checkout)\b/.test(lower),
    careersPage: segHas(/^(careers?|jobs?|hiring|join-us|join-our-team|vacancies|employment|work-with-us)$/) || /\b(we'?re hiring|now hiring|join our team|open (role|position)s?)\b/.test(lower),
    mobileReady,
  };
  return f;
}

/** Pages that look like job postings or a careers page. */
export function jobPages(pages: CrawledPage[]): CrawledPage[] {
  return pages.filter(
    (p) =>
      segments(p).some((s) => /^(careers?|jobs?|hiring|join-us|join-our-team|vacancies|employment|work-with-us)$/.test(s)) ||
      /\b(careers?|jobs?|hiring)\b/i.test(p.title) ||
      /\b(we'?re hiring|now hiring|join our team|open (role|position)s?)\b/i.test(p.fullText),
  );
}
