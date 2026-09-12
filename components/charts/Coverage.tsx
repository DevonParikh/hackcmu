"use client";
// C2 — What customers ask vs. what your site answers. Two numbers and one bar.

export default function Coverage({ total, answerable }: { total: number; answerable: number }) {
  if (!total) return null;
  const pct = Math.round((answerable / total) * 100);
  return (
    <div>
      <div className="flex items-baseline gap-6">
        <div><div className="text-5xl font-semibold tabular-nums">{total}</div><div className="text-muted">questions customers ask</div></div>
        <div><div className="text-5xl font-semibold tabular-nums">{answerable}</div><div className="text-muted">answered by your site today</div></div>
      </div>
      <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={`${pct}% of questions answerable from the site`}>
        <div className="h-full bg-green" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-sm text-muted">{pct}% covered. The rest becomes an email, a call, or a lost customer.</p>
    </div>
  );
}
