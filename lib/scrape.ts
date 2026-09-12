// lib/scrape.ts — Stage A. Crawl a small site: ~15 pages, same origin, useful pages first.
// Returns page text as sources plus brand colors and a logo guess from the home page.

import * as cheerio from "cheerio";
import type { Source } from "./schemas";

const MAX_PAGES = 15;
const PRIORITY = ["pricing", "price", "plans", "faq", "help", "support", "about", "contact", "services",
                  "menu", "book", "booking", "appointment", "reviews", "testimonials", "shop", "products", "blog"];
const SKIP = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|css|js)(\?|$)/i;

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
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const main = $("main").length ? $("main") : $("body");
  const text = main.text().replace(/\s+/g, " ").trim().slice(0, 12000);
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
const rank = (u: string) => { const i = PRIORITY.findIndex(k => u.toLowerCase().includes(k)); return i === -1 ? 999 : i; };

export async function scrapeSite(startUrl: string, log: (m: string) => void)
  : Promise<{ sources: Source[]; colors: string[]; logo: string | null }> {
  const origin = new URL(startUrl).origin;
  const seen = new Set<string>();
  const queue: string[] = [startUrl];
  const sources: Source[] = [];
  let colors: string[] = [];
  let logo: string | null = null;

  while (queue.length && sources.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (seen.has(norm(url))) continue;
    seen.add(norm(url));
    const html = await get(url);
    if (!html) continue;
    const { title, text } = pageText(html);
    if (text.length < 200) continue;
    sources.push({ url, title, kind: "page", text });
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
        if (u.origin === origin && !SKIP.test(u.pathname) && !seen.has(norm(u.href))) links.push(u.href);
      } catch { /* ignore bad hrefs */ }
    });
    links.sort((a, b) => rank(a) - rank(b));
    queue.push(...links);
  }
  return { sources, colors, logo };
}
