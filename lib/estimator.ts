// lib/estimator.ts — the instant estimate, trained by scripts/train-estimator.py from the pipeline's own runs.
// Two heads: which tool (classification; the one to show) and hours/week (regression; shown only if it earned it).
// Loads data/estimator.json if it exists; otherwise estimate() returns null.

import fs from "node:fs";
import path from "node:path";
import { FEATURE_NAMES, type Features } from "./features";
import { templateById } from "./schemas";

type Model = {
  features: string[]; mean: number[]; scale: number[]; n: number; trainedAt: string;
  coef?: number[]; intercept?: number; r2?: number; mae?: number; shipHours?: boolean;
  template?: { classes: string[]; coef: number[][]; intercept: number[]; acc: number; baseline: number; ship: boolean };
};

let cached: Model | null | undefined;
export function loadEstimator(): Model | null {
  if (cached !== undefined) return cached;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "estimator.json"), "utf8")) as Model;
    cached = Array.isArray(m.features) && Array.isArray(m.mean) ? m : null;
  } catch { cached = null; }
  return cached;
}

export type Estimate = {
  n: number;
  template?: { id: string; name: string; prob: number; acc: number; baseline: number; reasons: { label: string; weight: number }[] };
  hours?: { value: number; mae: number; contributions: { feature: string; label: string; hours: number }[] };
};

const NOUN: Record<string, string> = {
  hasFaq: "FAQ page", hasHours: "hours listed", hasPhone: "phone number", hasEmail: "email address",
  hasOnlineBooking: "online booking", hasOnlineOrdering: "online ordering", hasPricing: "prices listed", hasReviews: "reviews found",
  revCalled: "reviews mention calling", revEmail: "reviews mention email", revNoReply: "reviews mention no reply",
  revWaited: "reviews mention waiting", revRefund: "reviews mention refunds", revBooking: "reviews mention booking",
  indRestaurant: "restaurant", indSalon: "salon or barber", indMedical: "clinic or practice", indFitness: "gym or studio",
  indTrades: "trades or repair", indRetail: "retail", pages: "site size", kchars: "amount of text", thin: "JavaScript-built site",
};
export function describe(feature: string, value: number): string {
  const n = NOUN[feature] ?? feature;
  if (feature.startsWith("has")) return value ? `has ${n}` : `no ${n}`;
  if (feature.startsWith("rev")) return value ? `${n} ×${value}` : n.replace("mention", "don't mention");
  if (feature.startsWith("ind")) return value ? n : `not ${n}`;
  if (feature === "thin") return value ? n : "server-rendered site";
  return n;
}

export function estimate(f: Features): Estimate | null {
  const m = loadEstimator();
  if (!m) return null;
  const z = m.features.map((name, i) => { const x = (f as Record<string, number>)[name] ?? 0; return m.scale[i] ? (x - m.mean[i]) / m.scale[i] : 0; });
  const out: Estimate = { n: m.n };

  if (m.template?.ship) {
    const t = m.template;
    const logits = t.classes.map((_, k) => t.intercept[k] + t.coef[k].reduce((s, w, i) => s + w * z[i], 0));
    const mx = Math.max(...logits); const exps = logits.map(l => Math.exp(l - mx)); const sum = exps.reduce((a, b) => a + b, 0);
    const k = exps.indexOf(Math.max(...exps));
    const id = t.classes[k];
    const reasons = m.features.map((name, i) => ({ label: describe(name, (f as Record<string, number>)[name] ?? 0), weight: t.coef[k][i] * z[i] }))
      .sort((a, b) => b.weight - a.weight).slice(0, 3).filter(r => r.weight > 0.15);
    out.template = { id, name: templateById(id)?.name ?? id, prob: Math.round((exps[k] / sum) * 100) / 100, acc: t.acc, baseline: t.baseline, reasons };
  }

  if (m.shipHours && m.coef && m.intercept != null) {
    let total = m.intercept;
    const contributions = m.features.map((name, i) => { const c = m.coef![i] * z[i]; total += c; return { feature: name, label: describe(name, (f as Record<string, number>)[name] ?? 0), hours: Math.round(c * 10) / 10 }; })
      .sort((a, b) => Math.abs(b.hours) - Math.abs(a.hours)).slice(0, 4);
    out.hours = { value: Math.max(0, Math.round(total * 2) / 2), mae: m.mae ?? 0, contributions };
  }

  return out.template || out.hours ? out : null;
}
export { FEATURE_NAMES };
