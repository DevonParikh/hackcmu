import Link from "next/link";
import { StartForm } from "@/components/StartForm";
import { companies } from "@/lib/db";
import { isDemo } from "@/lib/llm";

export const dynamic = "force-dynamic";

export default async function Home() {
  let recent: { id: string; name: string; url: string; tagline: string; lastRunId: string | null; pageCount: number }[] = [];
  let dbError: string | null = null;
  try {
    const list = await (await companies()).find({}).sort({ updatedAt: -1 }).limit(8).toArray();
    recent = list.map((c) => ({ id: c._id, name: c.name, url: c.url, tagline: c.profile?.tagline ?? "", lastRunId: c.lastRunId, pageCount: c.pageCount }));
  } catch (e) {
    dbError = (e as Error).message;
  }
  const demo = isDemo();
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
        <section>
          <p className="eyebrow">Analyze a company</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight" style={{ textWrap: "balance" }}>
            Paste a website. Get one small AI tool the business can use today.
          </h1>
          <p className="mt-3 max-w-prose" style={{ color: "var(--muted)" }}>
            Tailor reads the company&apos;s site, compares it with competitors, shows what is working and what is not with evidence, then
            builds and hosts a targeted assistant with a one-line embed.
          </p>
          {demo && (
            <p className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--ochre-soft)", color: "#6b4a10" }}>
              Demo mode: no <span className="mono">ANTHROPIC_API_KEY</span> is set. Crawling, comparison, and MongoDB storage run for real; analysis
              text and tool replies come from deterministic heuristics instead of Claude.
            </p>
          )}
          <div className="mt-6">
            <StartForm />
          </div>
        </section>
        <aside>
          <p className="eyebrow">Recent companies</p>
          {dbError ? (
            <p className="mt-2 text-sm" style={{ color: "var(--bad)" }}>
              MongoDB is not reachable: {dbError}. Set <span className="mono">MONGODB_URI</span> and restart.
            </p>
          ) : recent.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Nothing analyzed yet. Companies you analyze are stored in MongoDB and listed here.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {recent.map((c) => (
                <li key={c.id} className="panel px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {c.pageCount} pages
                    </span>
                  </div>
                  <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
                    {c.tagline || c.url}
                  </div>
                  {c.lastRunId && (
                    <Link href={`/runs/${c.lastRunId}`} className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                      Open report →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-8">
            <p className="eyebrow">How it works</p>
            <ol className="mt-2 grid gap-1 text-sm" style={{ color: "var(--muted)" }}>
              <li>1. Reads up to 25 pages of the site, plus competitor sites you name.</li>
              <li>2. Profiles the company and detects tech, contact channels, and site features.</li>
              <li>3. Lists strengths, weaknesses, and friction signals, each with a source.</li>
              <li>4. Ranks six deployable tool templates and builds the best fit.</li>
              <li>5. Self-tests the tool, then hosts it with an embed snippet.</li>
            </ol>
          </div>
        </aside>
      </div>
    </main>
  );
}
