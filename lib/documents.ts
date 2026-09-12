// lib/documents.ts — text out of files the owner uploads on the start page: PDF, HTML, or any plain-text format.
// Each becomes a Source of kind "pasted", so the model can cite it by index like a crawled page.

import * as cheerio from "cheerio";
import type { Source } from "./schemas";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DOC_CHARS = 60_000;
const TEXT_TYPES = /^(text\/|application\/(json|csv|xml))/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|rtf)$/i;

const clean = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

/** Extracts readable text from one uploaded file. Throws a plain-language error the form can show. */
export async function documentSource(file: File): Promise<Source> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 10 MB. Please upload a smaller file.`);
  const name = file.name || "document";
  const type = file.type || "";
  const url = `upload:${name}`;

  if (type === "application/pdf" || /\.pdf$/i.test(name)) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(doc, { mergePages: true });
    const cleaned = clean(text);
    if (!cleaned) throw new Error(`${name} has no readable text (it may be a scanned image).`);
    return { url, title: name, kind: "pasted", text: cleaned.slice(0, MAX_DOC_CHARS) };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const probe = bytes.subarray(0, 4096);
  let odd = 0;
  for (const b of probe) if (b === 0 || (b < 9) || (b > 13 && b < 32)) odd++;
  if (probe.length && odd / probe.length > 0.02) throw new Error(`${name} does not look like a text document. Upload PDF, text, Markdown, CSV, or HTML.`);
  const raw = new TextDecoder("utf-8").decode(bytes);

  if (/html/i.test(type) || /\.html?$/i.test(name)) {
    const $ = cheerio.load(raw);
    $("script, style, noscript, svg").remove();
    return { url, title: $("title").first().text().trim() || name, kind: "pasted", text: clean($("body").text()).slice(0, MAX_DOC_CHARS) };
  }
  if (type && !TEXT_TYPES.test(type) && !TEXT_EXT.test(name)) throw new Error(`${name}: unsupported file type. Upload PDF, text, Markdown, CSV, or HTML.`);
  const cleaned = clean(raw);
  if (!cleaned) throw new Error(`${name} is empty.`);
  return { url, title: name, kind: "pasted", text: cleaned.slice(0, MAX_DOC_CHARS) };
}

/** Free text the owner typed on the start page, as one citable source. */
export function notesSource(notes: string): Source | null {
  const text = clean(notes);
  return text ? { url: "notes", title: "Notes from the owner", kind: "pasted", text: text.slice(0, MAX_DOC_CHARS) } : null;
}

/** "rival.com, https://other.com" → up to `max` distinct site URLs. */
export function competitorUrls(raw: string, max = 4): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const s = part.trim();
    if (!s) continue;
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      if (!u.hostname.includes(".")) continue;
      const href = `${u.origin}${u.pathname === "/" ? "" : u.pathname}`;
      if (!out.includes(href)) out.push(href);
    } catch { /* not a URL */ }
    if (out.length === max) break;
  }
  return out;
}
