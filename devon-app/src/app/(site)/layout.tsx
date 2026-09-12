import Link from "next/link";
import { AccessGate } from "@/components/AccessGate";
import { accessRequired, hasAccess } from "@/lib/access";

/** Layout for the owner-facing pages. Hosted tools at /t/[slug] use the bare root layout. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const gated = accessRequired() && !(await hasAccess());
  return (
    <>
      <header className="border-b" style={{ borderColor: "var(--rule)", background: "var(--panel)" }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Tailor
          </Link>
          <nav className="flex gap-4 text-sm" style={{ color: "var(--muted)" }}>
            <Link href="/">Analyze</Link>
            <a href="https://github.com/DevonParikh/hackcmu" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
        </div>
      </header>
      {gated ? <AccessGate /> : children}
    </>
  );
}
