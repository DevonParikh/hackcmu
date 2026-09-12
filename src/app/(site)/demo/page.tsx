import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = { title: "Schedule a demo · Tailor" };

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-12 md:py-16">
      <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:gap-14">
        <section>
          <p className="eyebrow">Schedule a demo</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl" style={{ textWrap: "balance" }}>
            See Tailor run on your own website, live.
          </h1>
          <p className="mt-3 text-base" style={{ color: "var(--muted)" }}>
            A twenty-minute video call. We paste your address, watch the analysis, and walk through the report and the assistant it
            builds. You leave with the hosted link whether or not you go further.
          </p>
          <ol className="steps mt-6">
            <li>
              <b>Minute 0 to 5.</b> Your site is read while we talk about what eats your week.
            </li>
            <li>
              <b>Minute 5 to 15.</b> The report: what customers can do on their own today, and the chores with evidence.
            </li>
            <li>
              <b>Minute 15 to 20.</b> The assistant, tested on ten real questions, and how it goes on your site.
            </li>
          </ol>
          <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
            Prefer to talk it through first?{" "}
            <Link href="/consult" className="link">
              Talk to a consultant
            </Link>
            .
          </p>
        </section>
        <ContactForm kind="demo" askTime messageLabel="Anything we should know before the call" messagePlaceholder="e.g. we get most questions by phone, and two of us answer them" submitLabel="Request a demo" />
      </div>
    </main>
  );
}
