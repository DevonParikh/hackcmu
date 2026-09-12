import Link from "next/link";
import { CaseBar, ChoreBars, Funnel, HoursLine, OutcomeBars, StatTiles, TypeRanges } from "@/components/LandingCharts";
import Start from "@/components/Start";
import { db } from "@/lib/db";
import { providersConfigured } from "@/lib/llm";
import { TEMPLATES, type Run } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Illustrative case studies for the landing page. Real reports link every figure to its source. */
const CASES = [
  {
    name: "Crust & Co. Bakery",
    type: "Bakery, 6 staff",
    tool: "Support & FAQ assistant",
    before: "Two people answered the same questions about custom cakes, allergens, and pickup times by email and Instagram every morning.",
    result: "5.1 hours back per week",
    hoursBefore: 7.2,
    hoursAfter: 2.1,
    detail: "78% of questions answered without a person. Custom-cake enquiries now arrive with size, date, and dietary needs already filled in.",
  },
  {
    name: "Bright Smile Dental",
    type: "Clinic, 2 dentists",
    tool: "Booking intake",
    before: "The front desk spent the first hour of every day returning voicemails to find out what each caller needed.",
    result: "7.9 hours back per week",
    hoursBefore: 10.4,
    hoursAfter: 2.5,
    detail: "Callers after hours describe the problem and pick a slot type. The desk confirms in one call instead of three.",
  },
  {
    name: "Pinehill Plumbing",
    type: "Home services, 4 vans",
    tool: "Lead / intake bot",
    before: "Quote requests came in as one-line web forms, and half needed a call back just to learn the address and the job.",
    result: "6.4 hours back per week",
    hoursBefore: 8.9,
    hoursAfter: 2.5,
    detail: "Leads now arrive with location, problem, photos, and urgency. The owner quotes from the van between jobs.",
  },
];

const STEPS = [
  { n: "1", title: "Paste your website", body: "One field. We read the site, its reviews, and its job posts. Nothing else is needed to start." },
  { n: "2", title: "We read and compare", body: "Your pages against competitors. Every claim keeps a link to where we saw it, and quotes are checked against the page." },
  { n: "3", title: "One assistant is recommended", body: "Picked from six proven types, scored on time saved and on whether your site holds enough to power it. If nothing fits, we say so." },
  { n: "4", title: "Test, then put it live", body: "A self-test runs before you see it. Rename it, set off-limits topics, then copy one line onto your site." },
];

/** Plain-language one-liners for the six templates in lib/schemas. */
const TEMPLATE_COPY: Record<string, { surface: string; summary: string }> = {
  "support-faq": { surface: "Chat bubble on the website", summary: "Answers customer questions from the company's own pages and hands off to a person when unsure." },
  "lead-intake": { surface: "Chat bubble or shareable link", summary: "Collects what a prospect needs, their timing and budget, and hands the owner a tidy summary." },
  "review-responder": { surface: "Private web page for staff", summary: "Paste a customer review and get an on-brand reply draft that addresses the specifics." },
  "booking-intake": { surface: "Chat bubble on the website", summary: "Collects the details of an order, appointment, or reservation and hands them to the owner or a booking link." },
  "listing-writer": { surface: "Private web page for staff", summary: "Turns product facts into listing copy in the company's voice, ready for the shop or marketplace." },
  "staff-knowledge": { surface: "Private link for staff", summary: "Lets staff ask about policies, services, and procedures from the company's own pages." },
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export default async function Home() {
  let recent: { id: string; name: string; url: string; tagline: string; pages: number }[] = [];
  let dbError: string | null = null;
  try {
    const list = (await (await db())
      .collection<Run>("runs")
      .find({ stage: "ranked" }, { projection: { url: 1, name: 1, "profile.name": 1, "profile.tagline": 1, "sources.kind": 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(24)
      .toArray()) as Run[];
    // One entry per business, newest first.
    const seen = new Set<string>();
    for (const r of list) {
      const name = r.profile?.name || r.name || host(r.url);
      const key = name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const profile = r.profile as { tagline?: string } | undefined;
      recent.push({ id: String(r._id), name, url: r.url, tagline: profile?.tagline ?? "", pages: (r.sources ?? []).filter((s) => s.kind === "page").length });
      if (recent.length === 6) break;
    }
  } catch (e) {
    dbError = (e as Error).message;
  }
  const providers = providersConfigured();

  return (
    <main>
      {/* ---------- Hero ---------- */}
      <section className="hero" id="analyze">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-14 pt-12 md:grid-cols-[1.05fr_1fr] md:gap-14 md:pt-20">
          <div>
            <p className="pill">
              <span className="pill-dot" aria-hidden="true" />
              Free analysis, about one minute
            </p>
            <h1 className="hero-title display mt-4" style={{ textWrap: "balance" }}>
              Paste a website. Find the chore. Get one small assistant that takes it over.
            </h1>
            <p className="mt-4 max-w-prose text-lg text-muted">
              Tailor reads your site, finds the repetitive thing that eats the most of your week, shows it in one chart with the evidence,
              and builds the one small AI tool that takes it over.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/demo" className="btn btn-lg">
                Schedule a demo
              </Link>
              <Link href="/consult" className="btn-ghost btn-lg">
                Talk to a consultant
              </Link>
            </div>
            <ul className="trust mt-8">
              <li>Every claim links to its source</li>
              <li>Self-tested before you see it</li>
              <li>Nothing goes live without you</li>
            </ul>
            {providers.length === 0 && (
              <p className="mt-6 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--ochre-soft)", color: "#7C3A0B" }}>
                No AI key is set on this server, so the analysis will stop after reading the site. Whoever set it up can add an Anthropic,
                Gemini, xAI, or OpenAI-compatible key to .env.local and restart.
              </p>
            )}
          </div>
          <div className="hero-form">
            <div className="card p-5 md:p-6">
              <h2 className="display text-2xl font-semibold">Analyze your business</h2>
              <p className="mb-4 text-muted">Start with your website. You will watch it being read.</p>
              <Start />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Headline numbers ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-12" id="results">
        <div className="section-head">
          <div>
            <p className="eyebrow">Results so far</p>
            <h2 className="section-h2 display">Small assistants, measured honestly</h2>
          </div>
          <p className="section-lede">
            Once an assistant is live, Tailor counts what it answered and what it handed to a person. These are sample figures that show
            what that looks like across a year of businesses.
          </p>
        </div>
        <div className="mt-6">
          <StatTiles />
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <HoursLine />
          <TypeRanges />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <OutcomeBars />
          <ChoreBars />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.35fr]">
          <Funnel />
          <div className="chart-card">
            <div className="chart-head">
              <div>
                <h3 className="chart-title">Businesses we have improved</h3>
                <p className="chart-sub">Three sample stories, one assistant each, hours a week before and after</p>
              </div>
            </div>
            <ul className="case-list">
              {CASES.map((c) => (
                <li key={c.name} className="case">
                  <div className="case-top">
                    <div>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-sm text-muted">
                        {c.type} · {c.tool}
                      </div>
                    </div>
                    <div className="case-result">{c.result}</div>
                  </div>
                  <div className="case-hours">
                    <CaseBar before={c.hoursBefore} after={c.hoursAfter} />
                    <span className="text-sm text-muted">
                      {c.hoursBefore.toFixed(1)} h a week on the chore before, {c.hoursAfter.toFixed(1)} h with the assistant
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    <b className="text-ink">Before.</b> {c.before}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    <b className="text-ink">After.</b> {c.detail}
                  </p>
                </li>
              ))}
            </ul>
            <p className="chart-note">Sample stories, shown to illustrate the programme.</p>
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="band" id="how">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="section-head">
            <div>
              <p className="eyebrow">How it works</p>
              <h2 className="section-h2 display">Four steps, no settings you would not understand</h2>
            </div>
            <p className="section-lede">Most small businesses do not need an AI strategy. They need one narrow thing that removes a daily chore, picked for them and handed over ready to use.</p>
          </div>
          <ol className="steps-grid mt-8">
            {STEPS.map((s) => (
              <li key={s.n} className="step">
                <div className="step-n" aria-hidden="true">
                  {s.n}
                </div>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- The six assistants ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-14" id="tools">
        <div className="section-head">
          <div>
            <p className="eyebrow">The six assistants</p>
            <h2 className="section-h2 display">Only things that can go live today</h2>
          </div>
          <p className="section-lede">Every recommendation comes from this list, so whatever Tailor suggests is something it can actually build and host.</p>
        </div>
        <ul className="tool-grid mt-8">
          {TEMPLATES.map((t) => {
            const copy = TEMPLATE_COPY[t.id];
            return (
              <li key={t.id} className="tool">
                <span className="chip chip-accent">{copy?.surface ?? "Hosted link"}</span>
                <h3 className="mt-3 font-semibold">{t.name}</h3>
                <p className="mt-1 text-sm text-muted">{copy?.summary}</p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------- Recent reports on this server ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-14" id="recent">
        <div className="section-head">
          <div>
            <p className="eyebrow">On this server</p>
            <h2 className="section-h2 display">Recent reports</h2>
          </div>
        </div>
        {dbError ? (
          <p className="mt-4 text-sm text-red">The database is not reachable right now, so past reports cannot be listed.</p>
        ) : recent.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nothing analyzed yet. Businesses you analyze appear here so you can come back to their reports.</p>
        ) : (
          <ul className="recent-grid mt-6">
            {recent.map((c) => (
              <li key={c.id} className="card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{c.name}</span>
                  {c.pages > 0 && <span className="text-sm text-muted">{c.pages} pages read</span>}
                </div>
                <div className="mt-0.5 truncate text-sm text-muted">{c.tagline || host(c.url)}</div>
                <Link href={`/report/${c.id}`} className="link mt-2 inline-block text-sm">
                  Open report →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- Closing call ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="cta">
          <div>
            <h2 className="display text-3xl font-semibold" style={{ textWrap: "balance" }}>
              Want a person to walk you through it?
            </h2>
            <p className="mt-2 max-w-prose" style={{ color: "rgba(255,255,255,.8)" }}>
              Book a twenty-minute demo on your own website, or a free call with a consultant who will tell you honestly whether an assistant would help.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/demo" className="btn btn-lg btn-onDark">
              Schedule a demo
            </Link>
            <Link href="/consult" className="btn-ghost btn-lg btn-ghost-onDark">
              Talk to a consultant
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
