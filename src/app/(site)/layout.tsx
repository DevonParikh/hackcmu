import Link from "next/link";
import { AccessGate } from "@/components/AccessGate";
import { accessRequired, hasAccess } from "@/lib/access";

/** Layout for the owner-facing pages. Hosted tools at /t/[slug] use the bare root layout. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const gated = accessRequired() && !(await hasAccess());
  return (
    <div className="site">
      <header className="site-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="brand" aria-label="Tailor home">
            <span className="brand-mark" aria-hidden="true">
              T
            </span>
            <span>Tailor</span>
          </Link>
          <nav className="site-nav" aria-label="Main">
            <Link href="/#how">How it works</Link>
            <Link href="/#results">Results</Link>
            <Link href="/#tools">Assistants</Link>
            <Link href="/consult">Consultant</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/demo" className="btn-ghost btn-sm">
              Schedule a demo
            </Link>
            <Link href="/#analyze" className="btn btn-sm">
              Analyze my site
            </Link>
          </div>
        </div>
      </header>
      <div className="site-body">{gated ? <AccessGate /> : children}</div>
      <footer className="site-footer">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                T
              </span>
              <span>Tailor</span>
            </div>
            <p className="mt-3 max-w-sm text-sm" style={{ color: "var(--muted)" }}>
              One small assistant, fitted to one business, with every claim traced to a source. Built for owners who are not technical.
            </p>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <Link href="/#analyze">Analyze a website</Link>
            <Link href="/#how">How it works</Link>
            <Link href="/#tools">The six assistants</Link>
            <Link href="/#results">Results</Link>
          </div>
          <div className="footer-col">
            <h4>Talk to us</h4>
            <Link href="/demo">Schedule a demo</Link>
            <Link href="/consult">Talk to a consultant</Link>
            <a href="mailto:hello@tailor.example">hello@tailor.example</a>
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            <a href="https://github.com/DevonParikh/hackcmu" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <span style={{ color: "var(--muted)" }}>Built at HackCMU</span>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-5 pb-8 text-xs" style={{ color: "var(--muted)" }}>
          Results shown on the home page are illustrative samples. Every figure in a real report links to where it came from.
        </div>
      </footer>
    </div>
  );
}
