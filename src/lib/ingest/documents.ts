import * as cheerio from "cheerio";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DOC_CHARS = 200_000;
const TEXT_TYPES = /^(text\/|application\/(json|csv|xml))/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|rtf)$/i;

interface ExtractedDocument {
  title: string;
  text: string;
  kind: "pdf" | "html" | "text";
}

function clean(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** Extracts readable text from an uploaded file. Supports PDF, HTML, and any plain-text format. */
export async function extractDocumentText(file: File): Promise<ExtractedDocument> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 10 MB. Please upload a smaller file.`);
  const name = file.name || "document";
  const type = file.type || "";
  const isPdf = type === "application/pdf" || /\.pdf$/i.test(name);
  if (isPdf) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const buf = new Uint8Array(await file.arrayBuffer());
    const doc = await getDocumentProxy(buf);
    const { text } = await extractText(doc, { mergePages: true });
    const cleaned = clean(text);
    if (!cleaned) throw new Error(`${name} has no readable text (it may be a scanned image).`);
    return { title: name, text: cleaned.slice(0, MAX_DOC_CHARS), kind: "pdf" };
  }
  const isHtml = /html/i.test(type) || /\.html?$/i.test(name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const probe = bytes.subarray(0, 4096);
  let odd = 0;
  for (const b of probe) if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) odd++;
  if (probe.length && odd / probe.length > 0.02) throw new Error(`${name} does not look like a text document. Upload PDF, text, Markdown, CSV, or HTML.`);
  const raw = new TextDecoder("utf-8").decode(bytes);
  if (isHtml) {
    const $ = cheerio.load(raw);
    $("script, style, noscript, svg").remove();
    const title = $("title").first().text().trim() || name;
    return { title, text: clean($("body").text()).slice(0, MAX_DOC_CHARS), kind: "html" };
  }
  if (!TEXT_TYPES.test(type) && !TEXT_EXT.test(name) && type !== "") {
    throw new Error(`${name}: unsupported file type. Upload PDF, text, Markdown, CSV, or HTML.`);
  }
  const cleaned = clean(raw);
  if (!cleaned) throw new Error(`${name} is empty.`);
  return { title: name, text: cleaned.slice(0, MAX_DOC_CHARS), kind: "text" };
}
