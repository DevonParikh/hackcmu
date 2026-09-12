import Link from "next/link";
import { StartForm } from "@/components/StartForm";
import { companies } from "@/lib/db";
import { isDemo } from "@/lib/llm";

export const dynamic = "force-dynamic";

export default async function Home() {
  let recent: { id: string; name: string; url: string; tagline: string; lastRunId: string | null; pageCount: number }[] = [];
  let dbError: string | null = null;
  try {
    const list = await (await companies()).find({ lastRunId: { $ne: null } }).sort({ updatedAt: -1 }).limit(8).toArray();
    recent = list.map((c) => ({ id: c._id, name: c.name, url: c.url, tagline: c.profile?.tagline ?? "", lastRunId: c.lastRunId, pageCount: c.pageCount }));
  } catch (e) {
    dbError = (e as Error).message;
  }
  const demo = isDemo();
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
        <section>
          <p className="eyebrow">For small businesses</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight" style={{ textWrap: "balance" }}>
            See where your week goes, then get one small assistant that gives some of it back.
          </h1>
          <p className="mt-3 max-w-prose" style={{ color: "var(--muted)" }}>
            Tailor reads your website and anything you add, compares you with competitors, shows the chores that eat time with the evidence
            for each, and builds a targeted assistant you can test and put on your site in minutes. Every number shows where it came from.
          </p>
          {demo && (
            <p className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--ochre-soft)", color: "#6b4a10" }}>
              Demo mode: no <span className="mono">ANTHROPIC_API_KEY</span> is set. Reading sites, comparing, and hosting tools all work; written analysis
              and assistant replies are quoted from the site instead of written by Claude.
            </p>
          )}
          <div className="mt-6">
            <StartForm />
          </div>
        </section>
        <aside>
          <p className="eyebrow">Recent businesses</p>
          {dbError ? (
            <p className="mt-2 text-sm" style={{ color: "var(--bad)" }}>
              The database is not reachable: {dbError}. Set <span className="mono">MONGODB_URI</span> and restart.
            </p>
          ) : recent.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Nothing analyzed yet. Businesses you analyze appear here so you can come back to their reports.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {recent.map((c) => (
                <li key={c.id} className="panel px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {c.pageCount} pages read
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
            <p className="eyebrow">What you get</p>
            <ol className="mt-2 grid gap-1.5 text-sm" style={{ color: "var(--muted)" }}>
              <li>1. A plain-language profile of your business from your own pages.</li>
              <li>2. What is written down where an assistant can read it, and what is not.</li>
              <li>3. Chores that eat time, each with a quote and a link to where we saw it.</li>
              <li>4. How you compare with competitors on ways customers can help themselves.</li>
              <li>5. One recommended assistant, tested on ten questions before you see it.</li>
              <li>6. Hours back per week as an honest range, once you give us one number.</li>
              <li>7. A hosted link and a one-line embed. Real usage counts once it is live.</li>
            </ol>
          </div>
        </aside>
      </div>
    </main>
  );
}
