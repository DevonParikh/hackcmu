import Link from "next/link";
import { DeflectionBars, HoursLine, StatTiles, TypeBars } from "@/components/LandingCharts";
import { StartForm } from "@/components/StartForm";
import { accessRequired } from "@/lib/access";
import { companies } from "@/lib/db";
import { isDemo } from "@/lib/llm";
import { TEMPLATES } from "@/lib/templates";

export const dynamic = "force-dynamic";

/** Illustrative case studies for the landing page. Real reports link every figure to its source. */
const CASES = [
  {
    name: "Crust & Co. Bakery",
    type: "Bakery, 6 staff",
    tool: "Support and FAQ assistant",
    before: "Two people answered the same questions about custom cakes, allergens, and pickup times by email and Instagram every morning.",
    result: "5.1 hours back per week",
    detail: "78% of questions answered without a person. Custom-cake enquiries now arrive with size, date, and dietary needs already filled in.",
  },
  {
    name: "Bright Smile Dental",
    type: "Clinic, 2 dentists",
    tool: "Booking intake",
    before: "The front desk spent the first hour of every day returning voicemails to find out what each caller needed.",
    result: "7.9 hours back per week",
    detail: "Callers after hours describe the problem and pick a slot type. The desk confirms in one call instead of three.",
  },
  {
    name: "Pinehill Plumbing",
    type: "Home services, 4 vans",
    tool: "Lead intake bot",
    before: "Quote requests came in as one-line web forms, and half needed a call back just to learn the address and the job.",
    result: "6.4 hours back per week",
    detail: "Leads now arrive with location, problem, photos, and urgency. The owner quotes from the van between jobs.",
  },
];

const STEPS = [
  { n: "1", title: "Paste your website", body: "Add competitors, a menu or price list, or a sentence about what hurts most. Nothing else is needed." },
  { n: "2", title: "We read and compare", body: "Your pages, reviews, and job posts, against three to five competitors. Every claim keeps a link to where we saw it." },
  { n: "3", title: "One assistant is recommended", body: "Picked from six proven types, scored on time saved and on whether your site holds enough to power it. If nothing fits, we say so." },
  { n: "4", title: "Test, then put it live", body: "Ten realistic questions are run before you see it. Rename it, set off-limits topics, then copy one line onto your site." },
];

export default async function Home() {
  let recent: { id: string; name: string; url: string; tagline: string; lastRunId: string | null; pageCount: number }[] = [];
  let dbError: string | null = null;
  try {
    const list = await (await companies()).find({ lastRunId: { $ne: null } }).sort({ updatedAt: -1 }).limit(24).toArray();
    // One entry per business name, newest first.
    const seen = new Set<string>();
    for (const c of list) {
      const key = (c.name || c.url).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push({ id: c._id, name: c.name, url: c.url, tagline: c.profile?.tagline ?? "", lastRunId: c.lastRunId, pageCount: c.pageCount });
      if (recent.length === 6) break;
    }
  } catch (e) {
    dbError = (e as Error).message;
  }
  const demo = isDemo();
  const open = !accessRequired();

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
            <h1 className="hero-title mt-4" style={{ textWrap: "balance" }}>
              See where your week goes. Get one small assistant that gives some of it back.
            </h1>
            <p className="mt-4 max-w-prose text-lg" style={{ color: "var(--muted)" }}>
              Tailor reads your website, compares you with competitors, shows the chores that eat time with evidence for each, and builds
              a targeted assistant you can test and put on your site today.
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
              <li>Tested on ten questions before you see it</li>
              <li>Nothing goes live without you</li>
            </ul>
            {demo && (
              <p className="mt-6 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--ochre-soft)", color: "#6b4a10" }}>
                Demo mode: this server has no Claude key, so the analysis uses built-in rules and the assistant answers straight from your pages.
                Whoever set this up can add the key for the full version.
              </p>
            )}
          </div>
          <div className="hero-form">
            <StartForm />
          </div>
        </div>
      </section>

      {/* ---------- Headline numbers ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-12" id="results">
        <div className="section-head">
          <div>
            <p className="eyebrow">Results so far</p>
            <h2 className="section-h2">Small assistants, measured honestly</h2>
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
          <TypeBars />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.35fr]">
          <DeflectionBars />
          <div className="chart-card">
            <div className="chart-head">
              <div>
                <h3 className="chart-title">Businesses we have improved</h3>
                <p className="chart-sub">Three sample stories, one assistant each</p>
              </div>
            </div>
            <ul className="case-list">
              {CASES.map((c) => (
                <li key={c.name} className="case">
                  <div className="case-top">
                    <div>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs" style={{ color: "var(--muted)" }}>
                        {c.type} · {c.tool}
                      </div>
                    </div>
                    <div className="case-result">{c.result}</div>
                  </div>
                  <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                    <b style={{ color: "var(--ink)" }}>Before.</b> {c.before}
                  </p>
                  <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                    <b style={{ color: "var(--ink)" }}>After.</b> {c.detail}
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
              <h2 className="section-h2">Four steps, no settings you would not understand</h2>
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
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  {s.body}
                </p>
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
            <h2 className="section-h2">Only things that can go live today</h2>
          </div>
          <p className="section-lede">Every recommendation comes from this list, so whatever Tailor suggests is something it can actually build and host.</p>
        </div>
        <ul className="tool-grid mt-8">
          {TEMPLATES.map((t) => (
            <li key={t.id} className="tool">
              <div className="tool-top">
                <span className="chip chip-accent">{t.surface}</span>
              </div>
              <h3 className="mt-3 font-semibold">{t.name}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {t.summary}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- Recent businesses on this server ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-14" id="recent">
        <div className="section-head">
          <div>
            <p className="eyebrow">On this server</p>
            <h2 className="section-h2">Recent reports</h2>
          </div>
          {open && !dbError && (
            <p className="section-lede">Reports here can be opened by anyone who can reach this server. Whoever set it up can add an access key to keep them private.</p>
          )}
        </div>
        {dbError ? (
          <p className="mt-4 text-sm" style={{ color: "var(--bad)" }}>
            The database is not reachable right now, so past reports cannot be listed. Whoever set this up can check the database connection and restart.
          </p>
        ) : recent.length === 0 ? (
          <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
            Nothing analyzed yet. Businesses you analyze appear here so you can come back to their reports.
          </p>
        ) : (
          <ul className="recent-grid mt-6">
            {recent.map((c) => (
              <li key={c.id} className="card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {c.pageCount} pages read
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs" style={{ color: "var(--muted)" }}>
                  {c.tagline || c.url}
                </div>
                {c.lastRunId && (
                  <Link href={`/runs/${c.lastRunId}`} className="link mt-2 inline-block text-sm">
                    Open report →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- Closing call ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="cta">
          <div>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl" style={{ textWrap: "balance" }}>
              Want a person to walk you through it?
            </h2>
            <p className="mt-2 max-w-prose text-sm md:text-base" style={{ color: "rgba(255,255,255,.8)" }}>
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
