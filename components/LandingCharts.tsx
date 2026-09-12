"use client";

import { useLayoutEffect, useRef, useState } from "react";

/*
 * Charts for the landing page. The figures are illustrative sample results (see the note under each
 * chart): the page shows what a finished programme looks like, not this server's own history.
 * Palette: indigo for the main series, burnt orange for a second, teal for a third (validated for
 * colour-vision deficiency against a white surface). Every chart has a table twin.
 */

const C = { series: "#4F46E5", second: "#C2410C", third: "#0D9488", neutral: "#B9B5AA", grid: "#E4E2DA", axis: "#B9B5AA", ink: "#101828", muted: "#5D6673", surface: "#FFFFFF" };

// ---------- Sample data ----------

export const MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
/** Hours given back per week across live assistants, by month: median with the middle half (25th to 75th percentile). */
export const HOURS_MEDIAN = [2.1, 2.6, 2.9, 3.4, 3.8, 4.3, 4.9, 5.2, 5.7, 6.1, 6.5, 6.8];
export const HOURS_P25 = [1.2, 1.5, 1.7, 2.0, 2.3, 2.6, 3.0, 3.2, 3.6, 3.9, 4.0, 4.1];
export const HOURS_P75 = [3.4, 3.9, 4.4, 5.0, 5.6, 6.2, 6.9, 7.4, 8.0, 8.6, 9.0, 9.3];
/** Businesses with a live assistant at the end of each month. */
export const LIVE_BY_MONTH = [6, 11, 17, 26, 34, 45, 58, 71, 86, 102, 116, 128];

export const BY_TYPE: { type: string; median: number; p25: number; p75: number; n: number }[] = [
  { type: "Dental and medical clinics", median: 7.4, p25: 5.1, p75: 9.8, n: 19 },
  { type: "Home services", median: 6.1, p25: 4.2, p75: 8.0, n: 24 },
  { type: "Law and accounting", median: 5.6, p25: 3.9, p75: 7.7, n: 12 },
  { type: "Fitness and studios", median: 4.9, p25: 3.3, p75: 6.4, n: 15 },
  { type: "Bakeries and cafes", median: 4.2, p25: 2.8, p75: 5.9, n: 31 },
  { type: "Salons and spas", median: 3.8, p25: 2.4, p75: 5.3, n: 27 },
];

/** Where each conversation ended, per assistant type, with the weekly volume behind the percentages. */
export const OUTCOMES: { tool: string; answered: number; handedOff: number; left: number; perWeek: number }[] = [
  { tool: "Lead / intake bot", answered: 81, handedOff: 16, left: 3, perWeek: 1240 },
  { tool: "Staff knowledge assistant", answered: 77, handedOff: 19, left: 4, perWeek: 610 },
  { tool: "Support & FAQ assistant", answered: 74, handedOff: 22, left: 4, perWeek: 2890 },
  { tool: "Booking intake", answered: 68, handedOff: 27, left: 5, perWeek: 1470 },
];

/** Hours per week on each chore before an assistant, and after, median across businesses that had the chore. */
export const CHORES: { chore: string; before: number; after: number; n: number }[] = [
  { chore: "Same questions by email and chat", before: 4.6, after: 1.3, n: 104 },
  { chore: "Same questions by phone", before: 3.9, after: 1.8, n: 88 },
  { chore: "Chasing booking and order details", before: 3.1, after: 0.9, n: 61 },
  { chore: "Replying to reviews", before: 1.4, after: 0.4, n: 47 },
  { chore: "Writing listings and descriptions", before: 1.2, after: 0.3, n: 22 },
];

/** From first paste to a working assistant. Counts over the last twelve months. */
export const FUNNEL: { stage: string; n: number; note: string }[] = [
  { stage: "Websites analyzed", n: 412, note: "each with a report" },
  { stage: "A tool was recommended", n: 371, note: "41 got 'nothing worth building' instead" },
  { stage: "Built and self-tested", n: 214, note: "median 38 minutes after the paste" },
  { stage: "Put live on a site", n: 128, note: "hosted link or one-line embed" },
  { stage: "Still live after 90 days", n: 117, note: "9 in 10 keep it" },
];

// ---------- Small pieces ----------

const fmt = (n: number) => n.toLocaleString("en-US");

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  // Measured before first paint so the chart never flashes at the fallback width.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(el.clientWidth || fallback);
    set();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

function TableToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="chart-toggle" onClick={onToggle} aria-pressed={open}>
      {open ? "Show chart" : "Show as table"}
    </button>
  );
}

function ChartHead({ title, sub, table, setTable }: { title: string; sub: string; table?: boolean; setTable?: (f: (v: boolean) => boolean) => void }) {
  return (
    <div className="chart-head">
      <div>
        <h3 className="chart-title">{title}</h3>
        <p className="chart-sub">{sub}</p>
      </div>
      {setTable && <TableToggle open={!!table} onToggle={() => setTable((v) => !v)} />}
    </div>
  );
}

const Note = () => <p className="chart-note">Sample figures, shown to illustrate the programme.</p>;

function Sparkline({ values, w = 96, h = 28 }: { values: number[]; w?: number; h?: number }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 6) + 3, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <path d={d} fill="none" stroke={C.series} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      <circle cx={lx} cy={ly} r={4} fill={C.series} stroke={C.surface} strokeWidth={2} />
    </svg>
  );
}

// ---------- Stat tiles ----------

export function StatTiles() {
  const tiles = [
    { label: "Businesses with a live assistant", value: "128", delta: "+12 this month", sub: "41 added this quarter", trend: LIVE_BY_MONTH },
    { label: "Hours given back per week", value: "6.8", delta: "+0.3 vs August", sub: "median; middle half 4.1 to 9.3", trend: HOURS_MEDIAN },
    { label: "Answered without a person", value: "74%", delta: "+2 pts vs August", sub: "of 21,400 conversations counted", trend: [61, 63, 66, 66, 68, 69, 70, 71, 72, 72, 73, 74] },
    { label: "Handed to a person", value: "22%", delta: "always with a name and number", sub: "4% left without an answer", trend: [33, 31, 29, 29, 27, 26, 25, 25, 24, 24, 23, 22] },
    { label: "Self-test before going live", value: "9.1 / 10", delta: "median score", sub: "6 of 128 needed a second pass", trend: [7.9, 8.1, 8.2, 8.4, 8.5, 8.6, 8.8, 8.8, 8.9, 9.0, 9.0, 9.1] },
    { label: "Paste to live assistant", value: "38 min", delta: "median", sub: "fastest 11 min, slowest 3 days", trend: [71, 66, 62, 58, 55, 52, 49, 46, 44, 41, 39, 38] },
  ];
  return (
    <div className="stat-grid">
      {tiles.map((t) => (
        <div key={t.label} className="stat">
          <div className="stat-label">{t.label}</div>
          <div className="flex items-end justify-between gap-3">
            <div className="stat-value display">{t.value}</div>
            <Sparkline values={t.trend} />
          </div>
          <div className="stat-delta">
            <span className="stat-delta-dot" aria-hidden="true" />
            {t.delta}
          </div>
          <div className="stat-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Line chart with a band, plus a column chart of live assistants on the same months ----------

export function HoursLine() {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const w = Math.max(320, width);
  const padL = 36;
  const padR = 20;
  const padT = 16;
  const lineH = 220;
  const gap = 34;
  const colH = 90;
  const padB = 26;
  const h = padT + lineH + gap + colH + padB;
  const plotW = w - padL - padR;
  const yMax = 10;
  const n = MONTHS.length;
  const last = n - 1;
  const x = (i: number) => padL + (i / last) * plotW;
  const y = (v: number) => padT + lineH - (v / yMax) * lineH;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const band = `${path(HOURS_P75)} ${HOURS_P25.map((v, i) => `L${x(last - i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} Z`;
  const colTop = padT + lineH + gap;
  const colMax = 140;
  const cy = (v: number) => colTop + colH - (v / colMax) * colH;
  const colW = Math.min(24, (plotW / n) * 0.55);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    setHover(Math.max(0, Math.min(last, Math.round(((px - padL) / plotW) * last))));
  }

  return (
    <div className="chart-card">
      <ChartHead title="Hours given back per week" sub="Median across live assistants with the middle half shaded, and how many assistants were live each month" table={table} setTable={setTable} />
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Median h/week</th>
              <th>25th pct</th>
              <th>75th pct</th>
              <th>Live assistants</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m, i) => (
              <tr key={m}>
                <td>{m}</td>
                <td>{HOURS_MEDIAN[i].toFixed(1)}</td>
                <td>{HOURS_P25[i].toFixed(1)}</td>
                <td>{HOURS_P75[i].toFixed(1)}</td>
                <td>{LIVE_BY_MONTH[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={ref} className="relative" style={{ width: "100%" }}>
          <svg
            viewBox={`0 0 ${w} ${h}`}
            role="img"
            aria-label="Median hours given back per week rising from 2.1 in October to 6.8 in September, with the middle half of businesses between 4.1 and 9.3 hours by September; live assistants growing from 6 to 128"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${w} / ${h}` }}
          >
            {[0, 2, 4, 6, 8, 10].map((t) => (
              <g key={t}>
                <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth={1} />
                <text x={padL - 8} y={y(t) + 4} fontSize={12} fill={C.muted} textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t}h
                </text>
              </g>
            ))}
            <path d={band} fill={C.series} opacity={0.12} />
            <path d={path(HOURS_MEDIAN)} fill="none" stroke={C.series} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={x(last)} cy={y(HOURS_MEDIAN[last])} r={4} fill={C.series} stroke={C.surface} strokeWidth={2} />
            <text x={x(last) - 8} y={y(HOURS_MEDIAN[last]) - 10} fontSize={13} fontWeight={600} fill={C.ink} textAnchor="end">
              median {HOURS_MEDIAN[last].toFixed(1)} h
            </text>
            <text x={x(last) - 8} y={y(HOURS_P75[last]) - 6} fontSize={11} fill={C.muted} textAnchor="end">
              middle half {HOURS_P25[last].toFixed(1)} to {HOURS_P75[last].toFixed(1)} h
            </text>

            <text x={padL} y={colTop - 10} fontSize={12} fontWeight={600} fill={C.ink}>
              Live assistants
            </text>
            {[0, 70, 140].map((t) => (
              <g key={t}>
                <line x1={padL} x2={w - padR} y1={cy(t)} y2={cy(t)} stroke={C.grid} strokeWidth={1} />
                <text x={padL - 8} y={cy(t) + 4} fontSize={11} fill={C.muted} textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t}
                </text>
              </g>
            ))}
            {LIVE_BY_MONTH.map((v, i) => (
              <rect key={i} x={x(i) - colW / 2} y={cy(v)} width={colW} height={colTop + colH - cy(v)} rx={3} fill={C.series} opacity={hover === null || hover === i ? 1 : 0.5} />
            ))}
            <text x={x(last)} y={cy(LIVE_BY_MONTH[last]) - 6} fontSize={12} fontWeight={600} fill={C.ink} textAnchor="middle">
              {LIVE_BY_MONTH[last]}
            </text>
            {MONTHS.map((m, i) => (
              <text key={m} x={x(i)} y={h - 8} fontSize={12} fill={C.muted} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>
                {m}
              </text>
            ))}
            {hover !== null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={padT} y2={colTop + colH} stroke={C.axis} strokeWidth={1} />
                <circle cx={x(hover)} cy={y(HOURS_MEDIAN[hover])} r={5} fill={C.series} stroke={C.surface} strokeWidth={2} />
              </>
            )}
          </svg>
          {hover !== null && (
            <div
              className="chart-tip"
              style={{ left: `${(x(hover) / w) * 100}%`, top: `${(y(HOURS_MEDIAN[hover]) / h) * 100}%`, transform: `translate(${hover > last / 2 ? "calc(-100% - 12px)" : "12px"}, -100%)` }}
            >
              <div className="chart-tip-title">{MONTHS[hover]}</div>
              <div>
                median <b>{HOURS_MEDIAN[hover].toFixed(1)} h</b> per week
              </div>
              <div>
                middle half {HOURS_P25[hover].toFixed(1)} to {HOURS_P75[hover].toFixed(1)} h
              </div>
              <div style={{ color: "#c9cbd6" }}>{LIVE_BY_MONTH[hover]} live assistants</div>
            </div>
          )}
        </div>
      )}
      <Note />
    </div>
  );
}

// ---------- Range bars: hours by business type ----------

export function TypeRanges() {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const max = 10;
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="chart-card">
      <ChartHead title="By business type" sub="Median hours per week, with the middle half of businesses as the light bar" table={table} setTable={setTable} />
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Business type</th>
              <th>Median</th>
              <th>25th pct</th>
              <th>75th pct</th>
              <th>Businesses</th>
            </tr>
          </thead>
          <tbody>
            {BY_TYPE.map((r) => (
              <tr key={r.type}>
                <td>{r.type}</td>
                <td>{r.median.toFixed(1)}</td>
                <td>{r.p25.toFixed(1)}</td>
                <td>{r.p75.toFixed(1)}</td>
                <td>{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="hbars" role="img" aria-label="Range bars of median hours saved per week by business type, from 7.4 for clinics to 3.8 for salons">
            {BY_TYPE.map((r, i) => (
              <div key={r.type} className="hbar-row hbar-row-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${r.type}: median ${r.median.toFixed(1)} h, middle half ${r.p25.toFixed(1)} to ${r.p75.toFixed(1)} h, ${r.n} businesses`}>
                <div className="hbar-label">
                  {r.type}
                  <span className="hbar-n">{r.n} businesses</span>
                </div>
                <div className="hbar-track hbar-track-tall" style={{ opacity: hover === null || hover === i ? 1 : 0.55 }}>
                  <div className="hbar-range" style={{ left: pct(r.p25), width: pct(r.p75 - r.p25) }} />
                  <div className="hbar-median" style={{ left: pct(r.median) }} />
                </div>
                <div className="hbar-value">
                  {r.median.toFixed(1)} h<span className="hbar-value-sub">{r.p25.toFixed(1)} to {r.p75.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="swatch" style={{ background: C.series }} /> Median
            </span>
            <span>
              <i className="swatch" style={{ background: C.series, opacity: 0.25 }} /> Middle half of businesses
            </span>
          </div>
        </>
      )}
      <Note />
    </div>
  );
}

// ---------- Stacked bars: where conversations ended ----------

export function OutcomeBars() {
  const [table, setTable] = useState(false);
  return (
    <div className="chart-card">
      <ChartHead title="Where conversations ended" sub="Share per assistant type, over the conversations counted each week" table={table} setTable={setTable} />
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Assistant</th>
              <th>Answered</th>
              <th>Handed to a person</th>
              <th>Left without an answer</th>
              <th>Conversations / week</th>
            </tr>
          </thead>
          <tbody>
            {OUTCOMES.map((r) => (
              <tr key={r.tool}>
                <td>{r.tool}</td>
                <td>{r.answered}%</td>
                <td>{r.handedOff}%</td>
                <td>{r.left}%</td>
                <td>{fmt(r.perWeek)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="hbars" role="img" aria-label="Stacked bars per assistant type: answered by the assistant, handed to a person, or left without an answer">
            {OUTCOMES.map((r) => (
              <div key={r.tool} className="hbar-row hbar-row-2" title={`${r.tool}: ${r.answered}% answered, ${r.handedOff}% handed to a person, ${r.left}% left; ${fmt(r.perWeek)} conversations a week`}>
                <div className="hbar-label">
                  {r.tool}
                  <span className="hbar-n">{fmt(r.perWeek)} a week</span>
                </div>
                <div className="hbar-track hbar-stack">
                  <div className="hbar-fill" style={{ width: `${r.answered}%`, background: C.series }} />
                  <div className="hbar-fill" style={{ width: `${r.handedOff}%`, background: C.second }} />
                  <div className="hbar-fill" style={{ width: `${r.left}%`, background: C.neutral }} />
                </div>
                <div className="hbar-value">
                  {r.answered}%<span className="hbar-value-sub">{r.handedOff}% handed off</span>
                </div>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="swatch" style={{ background: C.series }} /> Answered by the assistant
            </span>
            <span>
              <i className="swatch" style={{ background: C.second }} /> Handed to a person
            </span>
            <span>
              <i className="swatch" style={{ background: C.neutral }} /> Left without an answer
            </span>
          </div>
        </>
      )}
      <Note />
    </div>
  );
}

// ---------- Paired bars: hours per chore before and after ----------

export function ChoreBars() {
  const [table, setTable] = useState(false);
  const max = 5;
  return (
    <div className="chart-card">
      <ChartHead title="Which chores gave the hours back" sub="Hours per week on each chore before an assistant and after, median across the businesses that had it" table={table} setTable={setTable} />
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Chore</th>
              <th>Before</th>
              <th>After</th>
              <th>Given back</th>
              <th>Businesses</th>
            </tr>
          </thead>
          <tbody>
            {CHORES.map((r) => (
              <tr key={r.chore}>
                <td>{r.chore}</td>
                <td>{r.before.toFixed(1)}</td>
                <td>{r.after.toFixed(1)}</td>
                <td>{(r.before - r.after).toFixed(1)}</td>
                <td>{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="hbars" role="img" aria-label="Paired bars per chore: hours per week before an assistant and after">
            {CHORES.map((r) => (
              <div key={r.chore} className="hbar-row hbar-row-2" title={`${r.chore}: ${r.before.toFixed(1)} h before, ${r.after.toFixed(1)} h after, across ${r.n} businesses`}>
                <div className="hbar-label">
                  {r.chore}
                  <span className="hbar-n">{r.n} businesses</span>
                </div>
                <div className="hbar-pair">
                  <div className="hbar-track hbar-track-thin">
                    <div className="hbar-fill" style={{ width: `${(r.before / max) * 100}%`, background: C.second }} />
                  </div>
                  <div className="hbar-track hbar-track-thin">
                    <div className="hbar-fill" style={{ width: `${(r.after / max) * 100}%`, background: C.series }} />
                  </div>
                </div>
                <div className="hbar-value">
                  &minus;{(r.before - r.after).toFixed(1)} h<span className="hbar-value-sub">{r.before.toFixed(1)} to {r.after.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="swatch" style={{ background: C.second }} /> Before
            </span>
            <span>
              <i className="swatch" style={{ background: C.series }} /> With an assistant
            </span>
          </div>
        </>
      )}
      <Note />
    </div>
  );
}

// ---------- Funnel: from first paste to still live ----------

export function Funnel() {
  const [table, setTable] = useState(false);
  const top = FUNNEL[0].n;
  return (
    <div className="chart-card">
      <ChartHead title="From first paste to still live" sub="Last twelve months, as a share of every website analyzed" table={table} setTable={setTable} />
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Businesses</th>
              <th>Share of analyzed</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {FUNNEL.map((r) => (
              <tr key={r.stage}>
                <td>{r.stage}</td>
                <td>{fmt(r.n)}</td>
                <td>{Math.round((r.n / top) * 100)}%</td>
                <td>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="hbars" role="img" aria-label="Funnel from 412 websites analyzed to 117 assistants still live after 90 days">
          {FUNNEL.map((r, i) => (
            <div key={r.stage} className="hbar-row hbar-row-2" title={`${r.stage}: ${fmt(r.n)}, ${Math.round((r.n / top) * 100)}% of analyzed`}>
              <div className="hbar-label">
                {r.stage}
                <span className="hbar-n">{r.note}</span>
              </div>
              <div className="hbar-track">
                <div className="hbar-fill" style={{ width: `${(r.n / top) * 100}%`, opacity: 1 - i * 0.12 }} />
              </div>
              <div className="hbar-value">
                {fmt(r.n)}<span className="hbar-value-sub">{Math.round((r.n / top) * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <Note />
    </div>
  );
}

// ---------- Before / after strip for a case study ----------

export function CaseBar({ before, after }: { before: number; after: number }) {
  const max = 12;
  return (
    <div className="case-bar" role="img" aria-label={`${before} hours a week before, ${after} after`}>
      <div className="hbar-track hbar-track-thin">
        <div className="hbar-fill" style={{ width: `${(before / max) * 100}%`, background: C.second }} />
      </div>
      <div className="hbar-track hbar-track-thin">
        <div className="hbar-fill" style={{ width: `${(after / max) * 100}%`, background: C.series }} />
      </div>
    </div>
  );
}
