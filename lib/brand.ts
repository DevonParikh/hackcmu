// lib/brand.ts — the business's own colour as the report's accent, kept readable on paper.

const INK = "#14213D";

export function safeAccent(hex?: string | null, fallback = INK): string {
  if (!hex) return fallback;
  let h = hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) h = "#" + [...h.slice(1)].map(c => c + c).join("");
  if (!/^#[0-9a-f]{6}$/.test(h)) return fallback;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > 0.5) {                                   // too light for paper: darken, keep the hue
    const d = (c: number) => Math.round(c * 255 * 0.5).toString(16).padStart(2, "0");
    return `#${d(r)}${d(g)}${d(b)}`;
  }
  return h;
}

export const roundHalf = (n: number) => Math.round(n * 2) / 2;
export const hoursWord = (n: number) => `${roundHalf(n)} hour${roundHalf(n) === 1 ? "" : "s"}`;
