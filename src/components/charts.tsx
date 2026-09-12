"use client";

import { useEffect, useRef, useState } from "react";
import type { Impact, TopicRow } from "@/lib/pipeline/impact";
import type { EvalCase } from "@/lib/types";

/*
 * Small charts. Bars, dots, and the topic grid are plain HTML so they reflow on a phone and every
 * value stays on screen as text. The route diagrams stay SVG (they are drawings) but come in a wide
 * and a stacked variant, chosen by CSS. One series hue (teal), status colours only where the colour
 * means good / warning / bad. Every value is also written as text, so nothing depends on colour alone.
 */
const C = {
  series: "#0f8f7c",
  seriesLight: "#6dbdb0",
  good: "#256b44",
  warn: "#8f5d13",
  bad: "#b23a3a",
  grid: "#d5dad6",
  axis: "#b8c0bb",
  ink: "#17212b",
  muted: "#5b6570",
  surface: "#ffffff",
  paper: "#f3f5f2",
};

export type BadgeKind = "site" | "file" | "compared" | "you" | "said" | "tested" | "estimate" | "measured";
export const BADGE_LABELS: Record<BadgeKind, string> = {
  site: "Seen on your site",
  file: "From your file",
  compared: "Compared",
  you: "Your number",
  said: "You told us",
  tested: "Tested",
  estimate: "Estimate",
  measured: "Measured",
};
/** Four-to-six word meanings for the legend at the top of the report. */
export const BADGE_MEANINGS: Record<BadgeKind, string> = {
  site: "found on one of your pages",
  file: "from a document you added",
  compared: "checked on competitors' public pages",
  you: "a figure you typed in",
  said: "something you wrote, not a number",
  tested: "from the ten-question self-test",
  estimate: "a range, arithmetic shown beside it",
  measured: "counted from real conversations",
};

export function Badge({ kind }: { kind: BadgeKind }) {
  return (
    <span className="badge" data-kind={kind}>
      {BADGE_LABELS[kind]}
    </span>
  );
}

// ---------- Sideways-scroll wrapper ----------

/** Wraps anything that may still be wider than the screen; shows "scroll sideways" only when it actually overflows. */
export function Scrollable({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      setOverflow(el.scrollWidth > el.clientWidth + 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    };
    check();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [children]);
  return (
    <div className="scrollable" data-overflow={overflow && !atEnd ? "true" : "false"}>
      <div ref={ref} className="chart-scroll">
        {children}
      </div>
      <p className="scroll-hint" aria-hidden="true">
        Scroll sideways →
      </p>
    </div>
  );
}

// ---------- Topic coverage table ----------

type CellState = "full" | "half" | "none" | "answered" | "handed_off" | "failed" | "untested";
const STATE_TEXT: Record<CellState, string> = {
  full: "written down",
  half: "mentioned once",
  none: "not found",
  answered: "answered",
  handed_off: "handed off",
  failed: "failed",
  untested: "not tested",
};

function shortName(s: string, max = 22): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Cuts at a word boundary, never mid-word; the full text goes in the title attribute. */
function shortWords(s: string, max = 38): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return (at > max / 2 ? cut.slice(0, at) : cut).replace(/[,;:(]$/, "") + "…";
}

export function TopicGrid({ topics, hasFiles }: { topics: TopicRow[]; hasFiles: boolean }) {
  const ordered = [...topics.filter((t) => t.starred), ...topics.filter((t) => !t.starred)];
  const cell = (state: CellState, opts: { href?: string | null; file?: string | null; title: string }) => {
    const found = state === "full" || state === "half";
    if (found && opts.href) {
      return (
        <a className="state" data-state={state} href={opts.href} target="_blank" rel="noreferrer" title={`${opts.title}: open ${opts.href}`} aria-label={`${opts.title}: ${STATE_TEXT[state]}, open the page in a new tab`}>
          {STATE_TEXT[state]}
        </a>
      );
    }
    return (
      <>
        <span className="state" data-state={state} title={opts.file ? `${opts.title}: ${STATE_TEXT[state]} in ${opts.file}` : `${opts.title}: ${STATE_TEXT[state]}`}>
          {STATE_TEXT[state]}
        </span>
        {found && opts.file && (
          <span className="ml-1 text-[11px]" style={{ color: "var(--muted)" }} title={opts.file}>
            {shortName(opts.file)}
          </span>
        )}
      </>
    );
  };
  return (
    <Scrollable>
      <table className="topic-table">
        <caption className="sr-only">Which customer topics are written down on your site and in your files, and how the self-test went. Starred rows are your own questions.</caption>
        <thead>
          <tr>
            <th scope="col">Topic</th>
            <th scope="col">Your site</th>
            <th scope="col">{hasFiles ? "Your files" : "Your files (none yet)"}</th>
            <th scope="col">Self-test</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((t) => (
            <tr key={t.id}>
              <th scope="row" title={t.label}>
                <span className="topic-label">
                  {t.starred ? "★ " : ""}
                  {shortWords(t.label)}
                </span>
              </th>
              <td>
                {cell(t.site, {
                  href: t.siteSource,
                  title: `${t.label} · your site`,
                })}
              </td>
              <td>
                {cell(t.files, {
                  file: t.fileSource,
                  title: `${t.label} · your files`,
                })}
              </td>
              <td>
                {cell(t.test ?? "untested", {
                  title: `${t.label} · self-test`,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scrollable>
  );
}

// ---------- Before / after route diagram ----------

function wrapText(t: string, max: number, maxLines = 3): string[] {
  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    if ((cur + " " + wd).trim().length > max && cur) {
      lines.push(cur.trim());
      cur = wd;
    } else cur = (cur + " " + wd).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[,;]?\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

type RouteProps = {
  channels: Impact["channels"];
  after: boolean;
  selfTest: Impact["selfTest"];
  waitLabel: string | null;
  waitAppliesTo?: "all" | "email";
  personLabel: string;
  selfServe: string[];
};

function routeCopy({ after, selfTest, waitLabel, waitAppliesTo, selfServe }: RouteProps) {
  const answered = selfTest ? selfTest.answered : null;
  const total = selfTest ? selfTest.total : null;
  const customerSub = answered !== null ? `answered from your pages in seconds, ${answered} of ${total} in the test, any hour` : "answered from your pages in seconds, any hour (build to measure)";
  const personSub = after
    ? answered !== null
      ? `everything else, ${(total ?? 0) - answered} of ${total} in the test, with your contact details`
      : "everything else, with your contact details"
    : waitLabel
      ? waitAppliesTo === "email"
        ? `email replies ${waitLabel}; no promise found for other ways`
        : `reply ${waitLabel}`
      : "reply time not provided";
  const footer = after ? "" : selfServe.length ? `Customers can already help themselves with: ${selfServe.join(", ")}. Everything else ends at a person.` : "Every route ends at a person; nothing on the site answers on its own.";
  return { customerSub, personSub, footer };
}

const END_TITLE_Y = 16;
const SUB_LINE_H = 13;
const endBoxHeight = (lines: number) => 24 + lines * SUB_LINE_H + 2;

function EndBox({ x, y, w, title, lines, strong }: { x: number; y: number; w: number; title: string; lines: string[]; strong?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={endBoxHeight(lines.length)} rx="6" fill={C.surface} stroke={strong ? C.series : C.grid} strokeWidth={strong ? 1.5 : 1} />
      <text x={x + 10} y={y + END_TITLE_Y} fontSize="12" fill={C.ink} fontWeight="600">
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={i} x={x + 10} y={y + 31 + i * SUB_LINE_H} fontSize="11" fill={C.muted}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Markers({ id }: { id: string }) {
  return (
    <defs>
      <marker id={`${id}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill={C.axis} />
      </marker>
      <marker id={`${id}-arrow-teal`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill={C.series} />
      </marker>
    </defs>
  );
}

function RouteWide(props: RouteProps) {
  const { channels, after, personLabel } = props;
  const { customerSub, personSub, footer } = routeCopy(props);
  const id = after ? "rw-after" : "rw-before";
  const rowH = 34,
    boxW = 132,
    boxH = 26,
    endW = 210;
  const midX = 190,
    rightX = after ? 430 : 260;
  const n = Math.max(channels.length, 1);
  const custLines = wrapText(customerSub, 32),
    personLines = wrapText(personSub, 32);
  const custH = endBoxHeight(custLines.length),
    personH = endBoxHeight(personLines.length);
  const chanH = 10 + n * rowH;
  const endGap = 22;
  const rightH = after ? custH + endGap + personH : personH;
  const w = rightX + endW + 4;
  const footerLines = footer ? wrapText(footer, Math.floor(w / 6.2), 3) : [];
  const footerH = footerLines.length ? 8 + footerLines.length * 14 : 4;
  const h = Math.max(chanH, rightH + 10) + footerH;
  const chanMid = 10 + (n * rowH - rowH) / 2 + boxH / 2;
  const custY = after ? Math.max(6, (h - footerH) / 2 - rightH / 2) : 0;
  const personY = after ? custY + custH + endGap : Math.max(6, chanMid - personH / 2);
  const targetY = after ? chanMid : personY + personH / 2;
  return (
    <svg className="route-wide" viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxWidth: w, height: "auto" }} role="img" aria-label={after ? "Where questions go with the assistant" : "Where questions go today"}>
      <Markers id={id} />
      {channels.map((c, i) => {
        const y = 10 + i * rowH;
        const targetX = after ? midX : rightX;
        return (
          <g key={c.id}>
            <rect x={0} y={y} width={boxW} height={boxH} rx="6" fill={C.surface} stroke={C.grid} />
            <text x={10} y={y + 17} fontSize="12" fill={C.ink}>
              {c.label}
            </text>
            <line x1={boxW} y1={y + boxH / 2} x2={targetX - 4} y2={targetY} stroke={C.axis} strokeWidth="1.5" markerEnd={`url(#${id}-arrow)`} />
          </g>
        );
      })}
      {after ? (
        <g>
          <rect x={midX} y={chanMid - boxH / 2 - 4} width={boxW} height={boxH + 8} rx="8" fill={C.series} />
          <text x={midX + boxW / 2} y={chanMid + 4} fontSize="12" fill="#fff" textAnchor="middle" fontWeight="600">
            Your assistant
          </text>
          <line x1={midX + boxW} y1={chanMid - 4} x2={rightX - 4} y2={custY + custH / 2} stroke={C.series} strokeWidth="2" markerEnd={`url(#${id}-arrow-teal)`} />
          <line x1={midX + boxW} y1={chanMid + 6} x2={rightX - 4} y2={personY + personH / 2} stroke={C.axis} strokeWidth="1.5" strokeDasharray="4 3" markerEnd={`url(#${id}-arrow)`} />
          <EndBox x={rightX} y={custY} w={endW} title="A customer" lines={custLines} strong />
          <EndBox x={rightX} y={personY} w={endW} title={personLabel} lines={personLines} />
        </g>
      ) : (
        <g>
          <EndBox x={rightX} y={personY} w={endW} title={personLabel} lines={personLines} />
          {footerLines.map((l, i) => (
            <text key={i} x={0} y={h - footerH + 14 + i * 14} fontSize="11" fill={C.muted}>
              {l}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}

/** Stacked variant for phones: channels on top, everything flows downward. Drawn at its real size, no scaling. */
function RouteCompact(props: RouteProps) {
  const { channels, after, personLabel } = props;
  const { customerSub, personSub, footer } = routeCopy(props);
  const id = after ? "rc-after" : "rc-before";
  const W = 360,
    boxW = 112,
    gap = 8,
    boxH = 26,
    rowH = 34,
    perRow = 3;
  const n = Math.max(channels.length, 1);
  const rows = Math.ceil(n / perRow);
  const pos = (i: number) => ({
    x: (i % perRow) * (boxW + gap),
    y: 4 + Math.floor(i / perRow) * rowH,
  });
  const cx = (i: number) => pos(i).x + boxW / 2;
  const chanBottom = 4 + rows * rowH - (rowH - boxH);
  const busY = chanBottom + 14;
  const busX1 = cx(0),
    busX2 = cx(Math.min(n, perRow) - 1);
  const midX = W / 2;
  const assistantY = busY + 22,
    assistantH = 34,
    assistantW = 132;
  const endW = 174;
  const custLines = wrapText(customerSub, 27, 4),
    personLines = wrapText(personSub, 27, 4);
  const custH = endBoxHeight(custLines.length),
    personH = endBoxHeight(personLines.length);
  const endY = after ? assistantY + assistantH + 26 : busY + 22;
  const beforeW = 210,
    beforeX = (W - beforeW) / 2;
  const beforeLines = wrapText(personSub, 32);
  const beforeH = endBoxHeight(beforeLines.length);
  const footerLines = footer ? wrapText(footer, 56, 3) : [];
  const footerH = footerLines.length ? 8 + footerLines.length * 14 : 0;
  const h = after ? endY + Math.max(custH, personH) + 4 : endY + beforeH + 6 + footerH;
  return (
    <svg className="route-compact" viewBox={`0 0 ${W} ${h}`} style={{ width: "100%", maxWidth: W, height: "auto" }} role="img" aria-label={after ? "Where questions go with the assistant" : "Where questions go today"}>
      <Markers id={id} />
      {/* connectors first so the boxes sit on top */}
      {channels.map((c, i) => (
        <line key={c.id} x1={cx(i)} y1={pos(i).y + boxH} x2={cx(i)} y2={busY} stroke={C.axis} strokeWidth="1.5" />
      ))}
      {n > 1 && <line x1={busX1} y1={busY} x2={busX2} y2={busY} stroke={C.axis} strokeWidth="1.5" />}
      <line x1={midX} y1={busY} x2={midX} y2={(after ? assistantY : endY) - 4} stroke={C.axis} strokeWidth="1.5" markerEnd={`url(#${id}-arrow)`} />
      {channels.map((c, i) => (
        <g key={c.id}>
          <rect x={pos(i).x} y={pos(i).y} width={boxW} height={boxH} rx="6" fill={C.surface} stroke={C.grid} />
          <text x={pos(i).x + 8} y={pos(i).y + 17} fontSize="12" fill={C.ink}>
            {c.label}
          </text>
        </g>
      ))}
      {after ? (
        <g>
          <rect x={midX - assistantW / 2} y={assistantY} width={assistantW} height={assistantH} rx="8" fill={C.series} />
          <text x={midX} y={assistantY + 21} fontSize="12" fill="#fff" textAnchor="middle" fontWeight="600">
            Your assistant
          </text>
          <line x1={midX - 30} y1={assistantY + assistantH} x2={endW / 2} y2={endY - 4} stroke={C.series} strokeWidth="2" markerEnd={`url(#${id}-arrow-teal)`} />
          <line x1={midX + 30} y1={assistantY + assistantH} x2={W - endW / 2} y2={endY - 4} stroke={C.axis} strokeWidth="1.5" strokeDasharray="4 3" markerEnd={`url(#${id}-arrow)`} />
          <EndBox x={0} y={endY} w={endW} title="A customer" lines={custLines} strong />
          <EndBox x={W - endW} y={endY} w={endW} title={personLabel} lines={personLines} />
        </g>
      ) : (
        <g>
          <EndBox x={beforeX} y={endY} w={beforeW} title={personLabel} lines={beforeLines} />
          {footerLines.map((l, i) => (
            <text key={i} x={0} y={endY + beforeH + 6 + 14 + i * 14} fontSize="11" fill={C.muted}>
              {l}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}

export function RouteDiagram(props: RouteProps) {
  return (
    <div>
      <RouteWide {...props} />
      <RouteCompact {...props} />
    </div>
  );
}

// ---------- Self-test outcome strip ----------

export function OutcomeStrip({ evals, demo }: { evals: EvalCase[]; demo: boolean }) {
  const cell = 34,
    gap = 6;
  const w = evals.length * (cell + gap),
    h = cell + 22;
  const colour = (o: EvalCase["outcome"]) => (o === "answered" ? C.series : o === "handed_off" ? C.warn : C.bad);
  const label = (o: EvalCase["outcome"]) => (o === "answered" ? "answered" : o === "handed_off" ? "handed to you" : "failed");
  const counts = {
    answered: evals.filter((e) => e.outcome === "answered").length,
    handed_off: evals.filter((e) => e.outcome === "handed_off").length,
    failed: evals.filter((e) => e.outcome === "failed").length,
  };
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
            <text x={i * (cell + gap) + cell / 2} y={cell + 16} fontSize="11" fill={C.muted} textAnchor="middle">
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

// ---------- Shared pieces for the HTML bar rows ----------

function Ticks({ at }: { at: number[] }) {
  return (
    <div className="crow-ticks" aria-hidden="true">
      {at.map((p, i) => (
        <i key={i} className="crow-tick" style={{ left: `${p}%` }} />
      ))}
    </div>
  );
}

function Axis({ ticks, widest }: { ticks: { at: number; label: string }[]; widest: string }) {
  return (
    <div className="crow crow-axis" aria-hidden="true">
      <span className="crow-label" />
      <div className="crow-track">
        {ticks.map((t, i) => (
          <span key={i} className="crow-tick-label" style={{ left: `${t.at}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <span className="crow-value">{widest}</span>
    </div>
  );
}

// ---------- Range bars ----------

export function RangeBar({ rows, unit, max }: { rows: { label: string; low: number; high: number | null; note?: string }[]; unit: string; max?: number }) {
  const scaleMax = Math.max(max ?? 0, ...rows.map((r) => r.high ?? r.low), 1);
  const pct = (v: number) => Math.min(100, (v / scaleMax) * 100);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(scaleMax * t * 10) / 10);
  const fmt = (r: { low: number; high: number | null }) => (r.high === null ? `≤ ${r.low}` : `${r.low}–${r.high}`);
  const widest = [...rows.map((r) => `${fmt(r)} ${unit}`)].sort((a, b) => b.length - a.length)[0] ?? "";
  return (
    <div className="cgrid mt-1">
      {rows.map((r) => {
        const isTick = r.high === null;
        const tip = `${r.label}: ${isTick ? `at most ${r.low}` : `${r.low} to ${r.high}`} ${unit}${r.note ? ` · ${r.note}` : ""}`;
        return (
          <div className="crow" key={r.label}>
            <span className="crow-label" title={tip}>
              {r.label}
            </span>
            <div className="crow-track" aria-hidden="true" title={tip}>
              <Ticks at={ticks.map(pct)} />
              {isTick ? (
                <>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      width: `${pct(r.low)}%`,
                      top: 6,
                      height: 6,
                      borderRadius: 3,
                      background: C.seriesLight,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: `calc(${pct(r.low)}% - 2px)`,
                      top: 0,
                      width: 4,
                      height: 18,
                      borderRadius: 2,
                      background: C.series,
                    }}
                  />
                </>
              ) : (
                <>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      width: `${pct(r.high!)}%`,
                      top: 8.5,
                      height: 1,
                      background: C.grid,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: `${pct(r.low)}%`,
                      width: `${Math.max(1, pct(r.high!) - pct(r.low))}%`,
                      top: 2,
                      height: 14,
                      borderRadius: 4,
                      background: C.series,
                    }}
                  />
                </>
              )}
            </div>
            <span className="crow-value">
              {fmt(r)} {unit}
            </span>
          </div>
        );
      })}
      <Axis ticks={ticks.map((t) => ({ at: pct(t), label: String(t) }))} widest={widest} />
    </div>
  );
}

// ---------- Wait bars (log scale) ----------

export function WaitBars({ today, assistantSeconds }: { today: Impact["wait"]["today"]; assistantSeconds: number | null }) {
  const ticks: [number, string][] = [
    [1 / 60, "1 min"],
    [1, "1 h"],
    [8, "8 h"],
    [24, "1 day"],
    [72, "3 days"],
  ];
  const minH = 1 / 120,
    maxH = 168;
  const pos = (hours: number) => ((Math.log10(Math.max(hours, minH)) - Math.log10(minH)) / (Math.log10(maxH) - Math.log10(minH))) * 100;
  const emailOnly = today?.appliesTo === "email";
  const rows = [
    today
      ? {
          label: emailOnly ? "Typical first reply today (email)" : "Typical first reply today",
          low: Math.max(today.low, 1 / 60),
          high: Math.max(today.high, 1 / 30),
          text: emailOnly ? `${today.label}, for email; no promise found for other ways` : today.label,
          fill: C.seriesLight,
        }
      : {
          label: "Typical first reply today",
          text: "reply time not provided",
          low: null,
          high: null,
          fill: C.seriesLight,
        },
    assistantSeconds !== null
      ? {
          label: "With the assistant",
          low: Math.max(assistantSeconds / 3600, minH),
          high: Math.max(assistantSeconds / 3600, minH) * 1.6,
          text: assistantSeconds < 1 ? "under a second (demo)" : `about ${assistantSeconds} seconds`,
          fill: C.series,
        }
      : {
          label: "With the assistant",
          text: "build and test to measure",
          low: null,
          high: null,
          fill: C.series,
        },
  ];
  const widest = [...rows.map((r) => r.text)].sort((a, b) => b.length - a.length)[0];
  return (
    <div className="cgrid wait-bars mt-1">
      {rows.map((r) => (
        <div className="crow" key={r.label}>
          <span className="crow-label">{r.label}</span>
          <div className="crow-track" aria-hidden="true">
            <Ticks at={ticks.map(([v]) => pos(v))} />
            {r.low !== null && r.high !== null && (
              <div
                style={{
                  position: "absolute",
                  left: `${pos(r.low)}%`,
                  width: `${Math.max(1.5, pos(r.high) - pos(r.low))}%`,
                  top: 2,
                  height: 14,
                  borderRadius: 4,
                  background: r.fill,
                }}
              />
            )}
          </div>
          <span className="crow-value crow-value-wrap">{r.text}</span>
        </div>
      ))}
      <Axis ticks={ticks.map(([v, l]) => ({ at: pos(v), label: l }))} widest={widest} />
    </div>
  );
}

// ---------- Self-serve dot plot ----------

export function SelfServeDots({ selfServe, companyName, afterBuild }: { selfServe: Impact["selfServe"]; companyName: string; afterBuild: boolean }) {
  const rows = [
    {
      name: companyName,
      count: selfServe.company.count as number | null,
      features: selfServe.company.features,
      anyHour: (afterBuild ? true : selfServe.company.anyHour) as boolean | null,
      you: true,
    },
    ...selfServe.competitors.map((c) => ({ ...c, you: false })),
  ];
  const pct = (v: number) => (v / 6) * 100;
  const anyHourText = (r: (typeof rows)[number]) => (r.anyHour === null ? "not read" : r.anyHour ? (r.you && afterBuild && !selfServe.company.anyHour ? "yes, once the assistant is on your site" : "yes") : "no");
  const tip = (r: (typeof rows)[number]) => `${r.name}: ${r.count === null ? "not read" : `${r.count} of 6 (${r.features.join(", ") || "none"})`}`;
  return (
    <>
      <div className="cgrid mt-1">
        {rows.map((r, i) => (
          <div className="crow" key={r.name + i}>
            <span className="crow-label" style={{ fontWeight: r.you ? 700 : 400 }} title={tip(r)}>
              {r.name}
            </span>
            <div className="crow-track" aria-hidden="true" title={tip(r)}>
              <Ticks at={[0, 1, 2, 3, 4, 5, 6].map(pct)} />
              {r.count === null ? (
                <div
                  style={{
                    position: "absolute",
                    left: "calc(0% - 6px)",
                    top: 3,
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    border: `2px solid ${C.axis}`,
                    background: C.surface,
                  }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    left: `calc(${pct(r.count)}% - 7px)`,
                    top: 2,
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: r.you ? C.series : C.axis,
                    border: `2px solid ${C.surface}`,
                    boxShadow: `0 0 0 1px ${r.you ? C.series : C.axis}`,
                  }}
                />
              )}
            </div>
            <span className="crow-value crow-value-wrap">{r.count === null ? "not read" : `${r.count} of 6 · any hour: ${anyHourText(r)}`}</span>
          </div>
        ))}
        <Axis
          ticks={[0, 1, 2, 3, 4, 5, 6].map((t) => ({
            at: pct(t),
            label: String(t),
          }))}
          widest="0 of 6 · any hour: no"
        />
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Counts online booking, live chat, FAQ, prices, contact form, and online ordering found on public pages. A difference of one is not meaningful; a hollow marker means we could not read that site.
      </p>
    </>
  );
}

// ---------- Usage bars (per day, answered vs handed off) ----------

export function UsageBars({ perDay }: { perDay: { day: string; answered: number; handedOff: number }[] }) {
  if (!perDay.length) return null;
  const max = Math.max(...perDay.map((d) => d.answered + d.handedOff), 1);
  const px = (n: number) => Math.round((n / max) * 84);
  return (
    <Scrollable>
      <ul className="usage" aria-label="Replies per day, answered versus handed off">
        {perDay.map((d) => {
          const total = d.answered + d.handedOff;
          return (
            <li key={d.day} className="usage-col" title={`${d.day}: ${d.answered} answered, ${d.handedOff} handed off`}>
              <span className="usage-total">{total}</span>
              <div className="usage-stack" aria-hidden="true">
                {d.answered > 0 && <i className="usage-seg" style={{ height: px(d.answered), background: C.series }} />}
                {d.handedOff > 0 && <i className="usage-seg" style={{ height: px(d.handedOff), background: C.warn }} />}
              </div>
              <span className="usage-day">{d.day.slice(5)}</span>
            </li>
          );
        })}
      </ul>
    </Scrollable>
  );
}
