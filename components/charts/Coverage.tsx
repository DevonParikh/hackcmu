"use client";
// C2 — What customers ask vs. what the site answers. The questions themselves are the chart.

export type Q = { text: string; answerable: boolean };

export default function Coverage({ questions, accent }: { questions: Q[]; accent: string }) {
  if (!questions.length) return null;
  const answered = questions.filter(q => q.answerable);
  const missing = questions.filter(q => !q.answerable);
  return (
    <div>
      <ul className="flex flex-wrap gap-2">
        {[...missing, ...answered].map((q, i) => (
          <li key={i}
            className={`max-w-full truncate rounded-full border px-3 py-1 text-sm ${q.answerable ? "border-line text-muted" : "text-white"}`}
            style={q.answerable ? undefined : { background: accent, borderColor: accent }}
            title={q.text}>
            {q.text}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">
        <span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: accent }} /> {missing.length} the site can't answer
        <span className="ml-4 inline-block h-2.5 w-2.5 rounded-full border border-line align-middle" /> {answered.length} it can
      </p>
    </div>
  );
}
