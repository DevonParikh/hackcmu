import type { CompanyDoc, RunDoc } from "./types";

/** The company as this run saw it. Older runs without a snapshot fall back to the shared document. */
export function companyForRun(run: RunDoc, shared: CompanyDoc | null): CompanyDoc | null {
  if (!shared) return null;
  if (!run.snapshot) return shared;
  return { ...shared, name: run.snapshot.name, url: run.snapshot.url, profile: run.snapshot.profile, features: run.snapshot.features, tech: run.snapshot.tech, brand: run.snapshot.brand, contact: run.snapshot.contact, pageCount: run.snapshot.pageCount };
}
