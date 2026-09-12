import { cookies } from "next/headers";

export const ACCESS_COOKIE = "tailor_access";

/** When TAILOR_ACCESS_KEY is set, the owner-facing pages and APIs need it; hosted tools stay public. */
export function accessRequired(): boolean {
  return !!process.env.TAILOR_ACCESS_KEY;
}

export async function hasAccess(): Promise<boolean> {
  if (!accessRequired()) return true;
  const jar = await cookies();
  return jar.get(ACCESS_COOKIE)?.value === process.env.TAILOR_ACCESS_KEY;
}

export function hasAccessFromRequest(req: Request): boolean {
  if (!accessRequired()) return true;
  const header = req.headers.get("x-tailor-key");
  if (header && header === process.env.TAILOR_ACCESS_KEY) return true;
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`));
  return !!m && decodeURIComponent(m[1]) === process.env.TAILOR_ACCESS_KEY;
}
