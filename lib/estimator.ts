// lib/estimator.ts — the instant estimate: a ridge regression over lib/features.ts, trained by scripts/train-estimator.py.
// Loads data/estimator.json if it exists; otherwise estimate() returns null and the UI shows nothing.

import fs from "node:fs";
import path from "node:path";
import { FEATURE_NAMES, type Features } from "./features";

type Model = {
  features: string[]; mean: number[]; scale: number[]; coef: number[]; intercept: number;
  n: number; r2: number; mae: number; trainedAt: string;
};

let cached: Model | null | undefined;
export function loadEstimator(): Model | null {
  if (cached !== undefined) return cached;
  try {
    const p = path.join(process.cwd(), "data", "estimator.json");
    const m = JSON.parse(fs.readFileSync(p, "utf8")) as Model;
    cached = m.features.length === m.coef.length ? m : null;
  } catch { cached = null; }
  return cached;
}

export type Estimate = { hours: number; contributions: { feature: string; label: string; hours: number }[]; n: number; r2: number; mae: number };

// Owner-language description of a feature at a given value: "no FAQ page", "reviews mention calling ×3", "restaurant".
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
  if (feature.startsWith("rev")) return value ? `${n} ×${value}` : `${n.replace("mention", "don't mention")}`;
  if (feature.startsWith("ind")) return value ? n : `not ${n}`;
  if (feature === "thin") return value ? n : "server-rendered site";
  return n;
}

export function estimate(f: Features): Estimate | null {
  const m = loadEstimator();
  if (!m) return null;
  let total = m.intercept;
  const contributions: { feature: string; label: string; hours: number }[] = [];
  m.features.forEach((name, i) => {
    const x = (f as Record<string, number>)[name] ?? 0;
    const z = m.scale[i] ? (x - m.mean[i]) / m.scale[i] : 0;
    const c = m.coef[i] * z;
    total += c;
    contributions.push({ feature: name, label: describe(name, x), hours: Math.round(c * 10) / 10 });
  });
  contributions.sort((a, b) => Math.abs(b.hours) - Math.abs(a.hours));
  return { hours: Math.max(0, Math.round(total * 2) / 2), contributions: contributions.slice(0, 4), n: m.n, r2: m.r2, mae: m.mae };
}

export { FEATURE_NAMES };
