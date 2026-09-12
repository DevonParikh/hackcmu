"use client";

import type { Impact, TopicRow } from "@/lib/pipeline/impact";
import type { EvalCase } from "@/lib/types";

/*
 * Small inline-SVG charts. One series hue (teal), a second (ochre) only when two series
 * are on screen, status colours only where the colour means good / warning / bad.
 * Every value is also written as text, so nothing depends on colour or hover alone.
 */
const C = {
  series: "#0f8f7c",
  seriesLight: "#6dbdb0",
  good: "#2e7d4f",
  warn: "#b9791e",
  bad: "#b23a3a",
  grid: "#d5dad6",
  axis: "#b8c0bb",
  ink: "#17212b",
  muted: "#66717c",
  surface: "#ffffff",
  paper: "#f3f5f2",
};

export function Badge({ kind }: { kind: "site" | "file" | "compared" | "you" | "tested" | "estimate" | "measured" }) {
  const label = { site: "Seen on your site", file: "From your file", compared: "Compared", you: "Your number", tested: "Tested", estimate: "Estimate", measured: "Measured" }[kind];
  return (
    <span className="badge" data-kind={kind}>
      {label}
    </span>
  );
}

// ---------- Topic coverage grid ----------

export function TopicGrid({ topics, hasFiles }: { topics: TopicRow[]; hasFiles: boolean }) {
  const cols: { key: "site" | "files" | "test"; label: string }[] = [
    { key: "site", label: "Your site" },
    { key: "files", label: hasFiles ? "Your files" : "Your files (none yet)" },
    { key: "test", label: "Self-test" },
  ];
  const rowH = 30, labelW = 240, cellW = 110, top = 28;
  const w = labelW + cols.length * cellW + 8, h = top + topics.length * rowH + 4;
  const fill = (state: string | null) =>
    state === "full" ? C.series : state === "half" ? C.seriesLight : state === "answered" ? C.series : state === "handed_off" ? C.warn : state === "failed" ? C.bad : "none";
  const text = (state: string | null) =>
    state === "full" ? "written down" : state === "half" ? "mentioned once" : state === "answered" ? "answered" : state === "handed_off" ? "handed off" : state === "failed" ? "failed" : state === "none" ? "not found" : "not tested";
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Which customer topics are written down on the site, in your files, and how the self-test went">
        {cols.map((c, i) => (
          <text key={c.key} x={labelW + i * cellW + cellW / 2} y={16} textAnchor="middle" fontSize="11" fill={C.muted} style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>
            {c.label}
          </text>
        ))}
        {topics.map((t, r) => {
          const y = top + r * rowH;
          return (
            <g key={t.id}>
              <line x1={0} x2={w} y1={y + rowH} y2={y + rowH} stroke={C.grid} strokeWidth="1" />
              <text x={0} y={y + rowH / 2 + 4} fontSize="13" fill={C.ink}>
                {t.starred ? "★ " : ""}
                {t.label.length > 34 ? t.label.slice(0, 33) + "…" : t.label}
              </text>
              {cols.map((c, i) => {
                const state = c.key === "test" ? t.test : t[c.key];
                const x = labelW + i * cellW + 8;
                const half = state === "half";
                return (
                  <g key={c.key}>
                    <title>{`${t.label} · ${c.label}: ${text(state)}${c.key === "site" && t.siteSource ? ` (${t.siteSource})` : ""}${c.key === "files" && t.fileSource ? ` (${t.fileSource})` : ""}`}</title>
                    <rect x={x} y={y + 7} width={cellW - 16} height={rowH - 14} rx="4" fill={fill(state) === "none" ? C.paper : half ? "#dcefe9" : fill(state)} stroke={fill(state) === "none" ? C.grid : half ? C.seriesLight : "none"} />
                    <text x={x + (cellW - 16) / 2} y={y + rowH / 2 + 4} textAnchor="middle" fontSize="11" fill={fill(state) === "none" ? C.muted : half ? C.ink : "#fff"}>
                      {text(state)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- Before / after route diagram ----------

export function RouteDiagram({ channels, after, selfTest, inquiriesPerWeek, waitLabel, personLabel }: { channels: Impact["channels"]; after: boolean; selfTest: Impact["selfTest"]; inquiriesPerWeek?: number; waitLabel: string | null; personLabel: string }) {
  const rowH = 34, boxW = 132, boxH = 26, endW = 210, endH = 44;
  const midX = 190, rightX = after ? 430 : 260;
  const n = Math.max(channels.length, 1);
  const answered = selfTest ? selfTest.answered : null;
  const total = selfTest ? selfTest.total : null;
  const counts = inquiriesPerWeek && answered !== null && total ? { yes: Math.round((inquiriesPerWeek * answered) / total), no: inquiriesPerWeek - Math.round((inquiriesPerWeek * answered) / total) } : null;
  const customerSub = answered !== null ? (counts ? `answered from your pages, about ${counts.yes} a week` : `answered from your pages, ${answered} of ${total} in the test`) : "answered from your pages (build to measure)";
  const personSub = after
    ? answered !== null
      ? counts
        ? `everything else, about ${counts.no} a week, with your contact details`
        : `everything else, ${(total ?? 0) - answered} of ${total}, with your contact details`
      : "everything else, with your contact details"
    : waitLabel
      ? `reply ${waitLabel}`
      : "reply time not provided";
  const chanH = 10 + n * rowH;
  const endGap = 24;
  const rightH = after ? endH * 2 + endGap : endH;
  const h = Math.max(chanH, rightH + 10) + 26;
  const w = rightX + endW + 4;
  const chanMid = 10 + (n * rowH - rowH) / 2 + boxH / 2;
  const custY = after ? Math.max(6, (h - 26) / 2 - rightH / 2) : 0;
  const personY = after ? custY + endH + endGap : Math.max(6, chanMid - endH / 2);
  const targetY = after ? chanMid : personY + endH / 2;
  const wrap = (t: string, max = 34): string[] => {
    const words = t.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const wd of words) {
      if ((cur + " " + wd).trim().length > max) {
        lines.push(cur.trim());
        cur = wd;
      } else cur = (cur + " " + wd).trim();
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 2);
  };
  const EndBox = ({ x, y, title, sub, strong }: { x: number; y: number; title: string; sub: string; strong?: boolean }) => {
    const lines = wrap(sub);
    return (
      <g>
        <rect x={x} y={y} width={endW} height={endH} rx="6" fill={C.surface} stroke={strong ? C.series : C.grid} strokeWidth={strong ? 1.5 : 1} />
        <text x={x + 10} y={y + 16} fontSize="12" fill={C.ink} fontWeight="600">
          {title}
        </text>
        {lines.map((l, i) => (
          <text key={i} x={x + 10} y={y + 29 + i * 11} fontSize="9.5" fill={C.muted}>
            {l}
          </text>
        ))}
      </g>
    );
  };
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={after ? "Where questions go with the assistant" : "Where questions go today"}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.axis} />
          </marker>
          <marker id="arrow-teal" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={C.series} />
          </marker>
        </defs>
        {channels.map((c, i) => {
          const y = 10 + i * rowH;
          const targetX = after ? midX : rightX;
          return (
            <g key={c.id}>
              <rect x={0} y={y} width={boxW} height={boxH} rx="6" fill={C.surface} stroke={C.grid} />
              <text x={10} y={y + 17} fontSize="12" fill={C.ink}>
                {c.label}
              </text>
              <line x1={boxW} y1={y + boxH / 2} x2={targetX - 4} y2={targetY} stroke={C.axis} strokeWidth="1.5" markerEnd="url(#arrow)" />
            </g>
          );
        })}
        {after ? (
          <g>
            <rect x={midX} y={chanMid - boxH / 2 - 4} width={boxW} height={boxH + 8} rx="8" fill={C.series} />
            <text x={midX + boxW / 2} y={chanMid + 4} fontSize="12" fill="#fff" textAnchor="middle" fontWeight="600">
              Your assistant
            </text>
            <line x1={midX + boxW} y1={chanMid - 4} x2={rightX - 4} y2={custY + endH / 2} stroke={C.series} strokeWidth="2" markerEnd="url(#arrow-teal)" />
            <line x1={midX + boxW} y1={chanMid + 6} x2={rightX - 4} y2={personY + endH / 2} stroke={C.axis} strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrow)" />
            <EndBox x={rightX} y={custY} title="A customer, in seconds, any hour" sub={customerSub} strong />
            <EndBox x={rightX} y={personY} title={personLabel} sub={personSub} />
          </g>
        ) : (
          <g>
            <EndBox x={rightX} y={personY} title={personLabel} sub={personSub} />
            <text x={0} y={h - 6} fontSize="11" fill={C.muted}>
              Every route ends at a person; nothing on the site answers on its own.
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------- Self-test outcome strip ----------

export function OutcomeStrip({ evals, demo }: { evals: EvalCase[]; demo: boolean }) {
  const cell = 34, gap = 6;
  const w = evals.length * (cell + gap), h = cell + 22;
  const colour = (o: EvalCase["outcome"]) => (o === "answered" ? C.series : o === "handed_off" ? C.warn : C.bad);
  const label = (o: EvalCase["outcome"]) => (o === "answered" ? "answered" : o === "handed_off" ? "handed to you" : "failed");
  const counts = { answered: evals.filter((e) => e.outcome === "answered").length, handed_off: evals.filter((e) => e.outcome === "handed_off").length, failed: evals.filter((e) => e.outcome === "failed").length };
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxWidth: w, height: "auto", display: "block" }} role="img" aria-label={`Self-test: ${counts.answered} answered, ${counts.handed_off} handed to you, ${counts.failed} failed`}>
        {evals.map((e, i) => (
          <g key={i}>
            <title>{`${i + 1}. ${e.question} — ${label(e.outcome)}`}</title>
            <rect x={i * (cell + gap)} y={0} width={cell} height={cell} rx="6" fill={colour(e.outcome)} />
            {e.starred && (
              <text x={i * (cell + gap) + cell / 2} y={cell / 2 + 5} fontSize="14" fill="#fff" textAnchor="middle">
                ★
              </text>
            )}
            <text x={i * (cell + gap) + cell / 2} y={cell + 15} fontSize="10" fill={C.muted} textAnchor="middle">
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
        <span>
          <i className="swatch" style={{ background: C.series }} /> answered on the spot ({counts.answered})
        </span>
        <span>
          <i className="swatch" style={{ background: C.warn }} /> handed to you with your contact details ({counts.handed_off})
        </span>
        <span>
          <i className="swatch" style={{ background: C.bad }} /> failed ({counts.failed})
        </span>
        <span>★ your own question</span>
        {demo && <span>· demo mode answers</span>}
      </div>
    </div>
  );
}

// ---------- Range bars ----------

export function RangeBar({ rows, unit, max }: { rows: { label: string; low: number; high: number | null; note?: string }[]; unit: string; max?: number }) {
  const labelW = 190, barW = 360, rowH = 44, top = 8;
  const scaleMax = Math.max(max ?? 0, ...rows.map((r) => r.high ?? r.low), 1);
  const x = (v: number) => labelW + (v / scaleMax) * barW;
  const w = labelW + barW + 90, h = top + rows.length * rowH + 18;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(scaleMax * t * 10) / 10);
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={rows.map((r) => `${r.label}: ${r.high === null ? `at most ${r.low}` : `${r.low} to ${r.high}`} ${unit}`).join("; ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={h - 18} stroke={C.grid} strokeWidth="1" />
            <text x={x(t)} y={h - 4} fontSize="10" fill={C.muted} textAnchor="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
              {t}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = top + i * rowH + 10;
          const isTick = r.high === null;
          return (
            <g key={r.label}>
              <title>{`${r.label}: ${isTick ? `at most ${r.low}` : `${r.low}–${r.high}`} ${unit}${r.note ? ` · ${r.note}` : ""}`}</title>
              <text x={0} y={y + 14} fontSize="12.5" fill={C.ink}>
                {r.label}
              </text>
              {isTick ? (
                <>
                  <line x1={x(0)} x2={x(r.low)} y1={y + 10} y2={y + 10} stroke={C.seriesLight} strokeWidth="6" strokeLinecap="round" />
                  <rect x={x(r.low) - 2} y={y} width="4" height="20" rx="2" fill={C.series} />
                </>
              ) : (
                <>
                  <line x1={x(0)} x2={x(r.high!)} y1={y + 10} y2={y + 10} stroke={C.grid} strokeWidth="1" />
                  <rect x={x(r.low)} y={y + 2} width={Math.max(4, x(r.high!) - x(r.low))} height="16" rx="4" fill={C.series} />
                </>
              )}
              <text x={x(scaleMax) + 8} y={y + 14} fontSize="12" fill={C.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
                {isTick ? `≤ ${r.low}` : `${r.low}–${r.high}`} {unit}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- Wait bars (log scale) ----------

export function WaitBars({ today, assistantSeconds }: { today: Impact["wait"]["today"]; assistantSeconds: number | null }) {
  const labelW = 170, barW = 380, rowH = 40;
  const ticks: [number, string][] = [
    [1 / 60, "1 min"],
    [1, "1 h"],
    [8, "8 h"],
    [24, "1 day"],
    [72, "3 days"],
  ];
  const minH = 1 / 120, maxH = 168;
  const x = (hours: number) => labelW + ((Math.log10(Math.max(hours, minH)) - Math.log10(minH)) / (Math.log10(maxH) - Math.log10(minH))) * barW;
  const rows = [
    today ? { label: "Typical first reply today", low: Math.max(today.low, 1 / 60), high: Math.max(today.high, 1 / 30), text: today.label, fill: C.seriesLight } : { label: "Typical first reply today", text: "reply time not provided", low: null, high: null, fill: C.seriesLight },
    assistantSeconds !== null ? { label: "With the assistant", low: Math.max(assistantSeconds / 3600, minH), high: Math.max(assistantSeconds / 3600, minH) * 1.6, text: assistantSeconds < 1 ? "under a second (demo)" : `about ${assistantSeconds} seconds`, fill: C.series } : { label: "With the assistant", text: "build and test to measure", low: null, high: null, fill: C.series },
  ];
  const w = labelW + barW + 150, h = rows.length * rowH + 30;
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Customer wait for a first answer, today versus with the assistant">
        {ticks.map(([v, l]) => (
          <g key={l}>
            <line x1={x(v)} x2={x(v)} y1={4} y2={h - 22} stroke={C.grid} />
            <text x={x(v)} y={h - 8} fontSize="10" fill={C.muted} textAnchor="middle">
              {l}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = 8 + i * rowH;
          return (
            <g key={r.label}>
              <text x={0} y={y + 14} fontSize="12.5" fill={C.ink}>
                {r.label}
              </text>
              {r.low !== null && r.high !== null ? (
                <rect x={x(r.low)} y={y + 2} width={Math.max(6, x(r.high) - x(r.low))} height="16" rx="4" fill={r.fill} />
              ) : null}
              <text x={r.low !== null && r.high !== null ? Math.min(x(r.high) + 8, w - 140) : labelW + 4} y={y + 14} fontSize="11.5" fill={C.muted}>
                {r.text}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- Self-serve dot plot ----------

export function SelfServeDots({ selfServe, companyName, afterBuild }: { selfServe: Impact["selfServe"]; companyName: string; afterBuild: boolean }) {
  const rows = [{ name: companyName, count: selfServe.company.count as number | null, features: selfServe.company.features, anyHour: (afterBuild ? true : selfServe.company.anyHour) as boolean | null, you: true }, ...selfServe.competitors.map((c) => ({ ...c, you: false }))];
  const labelW = 200, axisW = 240, rowH = 30, top = 22;
  const x = (v: number) => labelW + (v / 6) * axisW;
  const w = labelW + axisW + 150, h = top + rows.length * rowH + 20;
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Self-serve options you offer compared with competitors">
        {[0, 1, 2, 3, 4, 5, 6].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={h - 18} stroke={C.grid} />
            <text x={x(t)} y={h - 5} fontSize="10" fill={C.muted} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <text x={labelW + axisW + 16} y={14} fontSize="10.5" fill={C.muted}>
          self-serve any hour?
        </text>
        {rows.map((r, i) => {
          const y = top + i * rowH + 14;
          return (
            <g key={r.name + i}>
              <title>{`${r.name}: ${r.count === null ? "not read" : `${r.count} of 6 (${r.features.join(", ") || "none"})`}`}</title>
              <text x={0} y={y + 4} fontSize="12.5" fill={C.ink} fontWeight={r.you ? 700 : 400}>
                {r.name.length > 27 ? r.name.slice(0, 26) + "…" : r.name}
              </text>
              {r.count === null ? (
                <circle cx={x(0)} cy={y} r="6" fill="none" stroke={C.axis} strokeWidth="2" />
              ) : (
                <circle cx={x(r.count)} cy={y} r="7" fill={r.you ? C.series : C.axis} stroke={C.surface} strokeWidth="2" />
              )}
              <text x={labelW + axisW + 16} y={y + 4} fontSize="11.5" fill={C.ink}>
                {r.anyHour === null ? "?" : r.anyHour ? (r.you && afterBuild && !selfServe.company.anyHour ? "yes, via the assistant" : "yes") : "no"}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Counts online booking, live chat, FAQ, prices, contact form, and online ordering found on public pages. A one-point gap is noise; a hollow marker means we could not read that site.
      </p>
    </div>
  );
}

// ---------- Usage bars (per day, answered vs handed off) ----------

export function UsageBars({ perDay }: { perDay: { day: string; answered: number; handedOff: number }[] }) {
  if (!perDay.length) return null;
  const barW = 22, gap = 10, h = 90, labelH = 18;
  const max = Math.max(...perDay.map((d) => d.answered + d.handedOff), 1);
  const w = perDay.length * (barW + gap);
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${w} ${h + labelH}`} width={w} height={h + labelH} role="img" aria-label="Replies per day, answered versus handed off">
        {perDay.map((d, i) => {
          const total = d.answered + d.handedOff;
          const hA = (d.answered / max) * (h - 6), hH = (d.handedOff / max) * (h - 6);
          const x = i * (barW + gap);
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${d.answered} answered, ${d.handedOff} handed off`}</title>
              <rect x={x} y={h - hA} width={barW} height={hA} fill={C.series} rx="3" />
              {hH > 0 && <rect x={x} y={h - hA - hH - 2} width={barW} height={hH} fill={C.warn} rx="3" />}
              <text x={x + barW / 2} y={h - hA - hH - 6} fontSize="10" fill={C.ink} textAnchor="middle">
                {total}
              </text>
              <text x={x + barW / 2} y={h + 13} fontSize="9.5" fill={C.muted} textAnchor="middle">
                {d.day.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
