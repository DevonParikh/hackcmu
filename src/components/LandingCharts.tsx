"use client";

import { useLayoutEffect, useRef, useState } from "react";

/*
 * Charts for the landing page. The figures are illustrative sample results (see the note under each
 * chart): the page shows what a finished programme looks like, not this server's own history.
 * One series hue (teal) for magnitude; ochre only where a second series has to be told apart.
 * Every chart has a table twin so nothing depends on colour or hover alone.
 */

const C = { series: "#0f8f7c", second: "#8f5d13", grid: "#d5dad6", axis: "#b8c0bb", ink: "#17212b", muted: "#5b6570", surface: "#ffffff" };

// ---------- Sample data ----------

export const MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
/** Median hours given back per week across live assistants, by month. */
export const HOURS_BY_MONTH = [2.1, 2.6, 2.9, 3.4, 3.8, 4.3, 4.9, 5.2, 5.7, 6.1, 6.5, 6.8];
/** Businesses with a live assistant at the end of each month. */
export const LIVE_BY_MONTH = [6, 11, 17, 26, 34, 45, 58, 71, 86, 102, 116, 128];

export const HOURS_BY_TYPE: { type: string; hours: number; n: number }[] = [
  { type: "Dental and medical clinics", hours: 7.4, n: 19 },
  { type: "Home services", hours: 6.1, n: 24 },
  { type: "Law and accounting", hours: 5.6, n: 12 },
  { type: "Fitness and studios", hours: 4.9, n: 15 },
  { type: "Bakeries and cafes", hours: 4.2, n: 31 },
  { type: "Salons and spas", hours: 3.8, n: 27 },
];

export const DEFLECTION: { tool: string; answered: number; handedOff: number }[] = [
  { tool: "Lead intake bot", answered: 81, handedOff: 19 },
  { tool: "Staff knowledge assistant", answered: 77, handedOff: 23 },
  { tool: "Support and FAQ assistant", answered: 74, handedOff: 26 },
  { tool: "Booking intake", answered: 68, handedOff: 32 },
];

// ---------- Small pieces ----------

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
    { label: "Businesses with a live assistant", value: "128", delta: "+12 this month", trend: LIVE_BY_MONTH },
    { label: "Hours given back per week, median", value: "6.8", delta: "+0.3 vs August", trend: HOURS_BY_MONTH },
    { label: "Questions answered without a person", value: "74%", delta: "+2 pts vs August", trend: [61, 63, 66, 66, 68, 69, 70, 71, 72, 72, 73, 74] },
    { label: "Self-test passed before going live", value: "9.1 / 10", delta: "median score", trend: [7.9, 8.1, 8.2, 8.4, 8.5, 8.6, 8.8, 8.8, 8.9, 9.0, 9.0, 9.1] },
  ];
  return (
    <div className="stat-grid">
      {tiles.map((t) => (
        <div key={t.label} className="stat">
          <div className="stat-label">{t.label}</div>
          <div className="flex items-end justify-between gap-3">
            <div className="stat-value">{t.value}</div>
            <Sparkline values={t.trend} />
          </div>
          <div className="stat-delta">
            <span className="stat-delta-dot" aria-hidden="true" />
            {t.delta}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Line chart: hours given back per week ----------

export function HoursLine() {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const h = 240;
  const padL = 34;
  const padR = 20;
  const padT = 18;
  const padB = 30;
  const w = Math.max(320, width);
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const yMax = 8;
  const x = (i: number) => padL + (i / (HOURS_BY_MONTH.length - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const line = HOURS_BY_MONTH.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(HOURS_BY_MONTH.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, 2, 4, 6, 8];
  const last = HOURS_BY_MONTH.length - 1;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - padL) / plotW) * last);
    setHover(Math.max(0, Math.min(last, i)));
  }

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3 className="chart-title">Hours given back per week</h3>
          <p className="chart-sub">Median across live assistants, last twelve months</p>
        </div>
        <TableToggle open={table} onToggle={() => setTable((v) => !v)} />
      </div>
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Hours per week</th>
              <th>Live assistants</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m, i) => (
              <tr key={m}>
                <td>{m}</td>
                <td>{HOURS_BY_MONTH[i].toFixed(1)}</td>
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
            aria-label="Line chart of median hours given back per week, rising from 2.1 in October to 6.8 in September"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            style={{ display: "block", width: "100%", height: "auto", aspectRatio: `${w} / ${h}` }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth={1} />
                <text x={padL - 8} y={y(t) + 4} fontSize={11} fill={C.muted} textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t}h
                </text>
              </g>
            ))}
            {MONTHS.map((m, i) => (
              <text key={m} x={x(i)} y={h - 8} fontSize={11} fill={C.muted} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>
                {m}
              </text>
            ))}
            <path d={area} fill={C.series} opacity={0.1} />
            <path d={line} fill="none" stroke={C.series} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke={C.axis} strokeWidth={1} />}
            {hover !== null && <circle cx={x(hover)} cy={y(HOURS_BY_MONTH[hover])} r={5} fill={C.series} stroke={C.surface} strokeWidth={2} />}
            <circle cx={x(last)} cy={y(HOURS_BY_MONTH[last])} r={4} fill={C.series} stroke={C.surface} strokeWidth={2} />
            <text x={x(last) - 8} y={y(HOURS_BY_MONTH[last]) - 10} fontSize={12} fontWeight={600} fill={C.ink} textAnchor="end">
              {HOURS_BY_MONTH[last].toFixed(1)} h
            </text>
          </svg>
          {hover !== null && (
            <div
              className="chart-tip"
              style={{
                left: `${(x(hover) / w) * 100}%`,
                top: y(HOURS_BY_MONTH[hover]) - 12,
                transform: `translate(${hover > last / 2 ? "calc(-100% - 12px)" : "12px"}, -100%)`,
              }}
            >
              <div className="chart-tip-title">{MONTHS[hover]}</div>
              <div>
                <b>{HOURS_BY_MONTH[hover].toFixed(1)} h</b> per week
              </div>
              <div style={{ color: C.muted }}>{LIVE_BY_MONTH[hover]} live assistants</div>
            </div>
          )}
        </div>
      )}
      <p className="chart-note">Sample figures, shown to illustrate the programme.</p>
    </div>
  );
}

// ---------- Bars: hours saved by business type ----------

export function TypeBars() {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const max = 8;
  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3 className="chart-title">Where the hours come from</h3>
          <p className="chart-sub">Median hours per week by business type</p>
        </div>
        <TableToggle open={table} onToggle={() => setTable((v) => !v)} />
      </div>
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Business type</th>
              <th>Hours per week</th>
              <th>Businesses</th>
            </tr>
          </thead>
          <tbody>
            {HOURS_BY_TYPE.map((r) => (
              <tr key={r.type}>
                <td>{r.type}</td>
                <td>{r.hours.toFixed(1)}</td>
                <td>{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="hbars" role="img" aria-label="Bar chart of median hours saved per week by business type">
          {HOURS_BY_TYPE.map((r, i) => (
            <div
              key={r.type}
              className="hbar-row"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              title={`${r.type}: ${r.hours.toFixed(1)} hours per week across ${r.n} businesses`}
            >
              <div className="hbar-label">{r.type}</div>
              <div className="hbar-track">
                <div className="hbar-fill" style={{ width: `${(r.hours / max) * 100}%`, opacity: hover === null || hover === i ? 1 : 0.55 }} />
              </div>
              <div className="hbar-value">{r.hours.toFixed(1)} h</div>
            </div>
          ))}
        </div>
      )}
      <p className="chart-note">Sample figures, shown to illustrate the programme.</p>
    </div>
  );
}

// ---------- Stacked bars: answered vs handed off ----------

export function DeflectionBars() {
  const [table, setTable] = useState(false);
  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3 className="chart-title">Answered without a person</h3>
          <p className="chart-sub">Share of conversations each assistant type finishes on its own</p>
        </div>
        <TableToggle open={table} onToggle={() => setTable((v) => !v)} />
      </div>
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Assistant</th>
              <th>Answered</th>
              <th>Handed to a person</th>
            </tr>
          </thead>
          <tbody>
            {DEFLECTION.map((r) => (
              <tr key={r.tool}>
                <td>{r.tool}</td>
                <td>{r.answered}%</td>
                <td>{r.handedOff}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="hbars" role="img" aria-label="Stacked bars: share of conversations answered by the assistant versus handed to a person, per assistant type">
            {DEFLECTION.map((r) => (
              <div key={r.tool} className="hbar-row" title={`${r.tool}: ${r.answered}% answered, ${r.handedOff}% handed to a person`}>
                <div className="hbar-label">{r.tool}</div>
                <div className="hbar-track hbar-stack">
                  <div className="hbar-fill" style={{ width: `${r.answered}%`, background: C.series }} />
                  <div className="hbar-fill" style={{ width: `${r.handedOff}%`, background: C.second }} />
                </div>
                <div className="hbar-value">{r.answered}%</div>
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
          </div>
        </>
      )}
      <p className="chart-note">Sample figures, shown to illustrate the programme.</p>
    </div>
  );
}
