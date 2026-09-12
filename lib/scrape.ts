// lib/scrape.ts — Stage A. Crawl a small site: ~15 pages, same origin, useful pages first.
// Returns page text as sources plus brand colors and a logo guess from the home page.

import * as cheerio from "cheerio";
import type { Source } from "./schemas";

const MAX_PAGES = 15;
const PRIORITY = ["pricing", "price", "plans", "faq", "help", "support", "about", "contact", "services",
                  "menu", "book", "booking", "appointment", "reviews", "testimonials", "shop", "products", "blog"];
const SKIP = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|css|js)(\?|$)/i;
const JUNK = /\/(terms|terms-of-service|terms-and-conditions|privacy|privacy-policy|cookie|cookies|cookies-policy|accessibility|legal|login|log-in|signin|sign-in|signup|sign-up|register|cart|checkout|account|my-account|wp-admin|wp-login|feed|tag|tags|category|author|search|sitemap)(\/|$|\?)/i;
const PER_SECTION = 3;                                 // at most this many pages under one first path segment

async function get(url: string, ms = 8000): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; TailorBot/0.1; +hackcmu)", accept: "text/html" },
      signal: AbortSignal.timeout(ms),
      redirect: "follow",
    });
    if (!r.ok) return null;
    if (!(r.headers.get("content-type") ?? "").includes("html")) return null;
    return await r.text();
  } catch { return null; }
}

export function pageText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, template").remove();
  // Block elements have no whitespace between them in .text(); add some so "Monday" and "12:00" don't fuse.
  $("br").replaceWith("\n");
  $("span, a, b, i, em, strong, label").each((_, el) => { $(el).append(" "); });
  $("p, div, li, ul, ol, nav, main, aside, form, h1, h2, h3, h4, h5, h6, td, th, tr, section, article, header, footer, blockquote, dt, dd, figcaption").each((_, el) => { $(el).append("\n"); });
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const main = $("main").length ? $("main") : $("body");
  // one block per line, single spaces within a line; lines are what boilerplate removal works on
  const text = main.text().replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{2,}/g, "\n").trim().slice(0, 12000);
  return { title, text };
}

// Most-used non-grey hex colours in the page's inline styles and CSS — a brand-colour guess.
export function brandColors(html: string): string[] {
  const hits = html.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi) ?? [];
  const counts = new Map<string, number>();
  for (const h of hits) { const k = h.toLowerCase(); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const grey = (h: string) => {
    const c = h.length === 4 ? [...h.slice(1)].map(x => x + x).join("") : h.slice(1);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b) < 24;
  };
  return [...counts.entries()].filter(([h]) => !grey(h)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h);
}

const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "");
const depth = (u: string) => { try { return new URL(u).pathname.split("/").filter(Boolean).length; } catch { return 9; } };
const section = (u: string) => { try { return new URL(u).pathname.split("/").filter(Boolean)[0] ?? ""; } catch { return ""; } };
// shallow pages first (/menu before /menu/samosa), then the useful ones (/faq, /contact) ahead of the rest
export const rank = (u: string) => {
  const i = PRIORITY.findIndex(k => u.toLowerCase().includes(k));
  return depth(u) * 10 + (i === -1 ? 9 : Math.min(i, 8));
};

export async function scrapeSite(startUrl: string, log: (m: string) => void)
  : Promise<{ sources: Source[]; colors: string[]; logo: string | null; thin: boolean }> {
  const origin = new URL(startUrl).origin;
  const seen = new Set<string>();
  const queue: string[] = [startUrl];
  const sources: Source[] = [];
  const perSection = new Map<string, number>();
  let colors: string[] = [];
  let logo: string | null = null;
  let thin = false;                                  // big HTML, almost no text → rendered with JavaScript

  while (queue.length && sources.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (seen.has(norm(url))) continue;
    seen.add(norm(url));
    const sec = section(url);
    if (sec && (perSection.get(sec) ?? 0) >= PER_SECTION) continue;
    const html = await get(url);
    if (!html) continue;
    const { title, text } = pageText(html);
    if (sources.length === 0 && html.length > 40_000 && text.length < 500) thin = true;
    if (text.length < 200) continue;
    sources.push({ url, title, kind: "page", text });
    if (sec) perSection.set(sec, (perSection.get(sec) ?? 0) + 1);
    log(`Reading ${title || url}`);

    const $ = cheerio.load(html);
    if (sources.length === 1) {
      colors = brandColors(html);
      const raw = $('link[rel~="icon"]').attr("href") ?? $('meta[property="og:image"]').attr("content") ?? null;
      if (raw) { try { logo = new URL(raw, url).href; } catch { logo = null; } }
    }
    const links: string[] = [];
    $("a[href]").each((_, a) => {
      try {
        const u = new URL($(a).attr("href")!, url);
        if (u.origin === origin && !SKIP.test(u.pathname) && !JUNK.test(u.pathname + "/") && !seen.has(norm(u.href))) links.push(u.href);
      } catch { /* ignore bad hrefs */ }
    });
    queue.push(...links);
    queue.sort((a, b) => rank(a) - rank(b));               // re-sort the whole frontier: shallow, useful pages first
  }
  return { sources, colors, logo, thin };
}
