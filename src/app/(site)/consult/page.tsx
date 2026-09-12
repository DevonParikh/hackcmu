import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = { title: "Talk to a consultant · Tailor" };

export default function ConsultPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-12 md:py-16">
      <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:gap-14">
        <section>
          <p className="eyebrow">Talk to a consultant</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl" style={{ textWrap: "balance" }}>
            Not sure what would help? Ask someone who has done this a hundred times.
          </h1>
          <p className="mt-3 text-base" style={{ color: "var(--muted)" }}>
            A free thirty-minute call with a Tailor consultant. Bring the chore that annoys you most. We tell you honestly whether a small
            assistant would take it off your plate, and what it would need from you.
          </p>
          <ul className="ticks mt-6">
            <li>Which of the six assistant types fits your business, if any.</li>
            <li>What has to be written down first, and how long that takes.</li>
            <li>What to expect in hours back per week, as a range with the arithmetic.</li>
            <li>How to switch it off, and what it will never say to a customer.</li>
          </ul>
          <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
            Want to see it running instead?{" "}
            <Link href="/demo" className="link">
              Schedule a demo
            </Link>
            .
          </p>
        </section>
        <ContactForm kind="consult" askTime messageLabel="What takes up the most time right now" messagePlaceholder="e.g. answering the same emails about hours and pricing" submitLabel="Book a call" />
      </div>
    </main>
  );
}
