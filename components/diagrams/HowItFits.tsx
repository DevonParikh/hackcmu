// D1 — How it fits. Customer → the tool → outcomes. One SVG with slots; no diagram library. Server-safe.

export default function HowItFits({ toolName, company, money, booking, accent }:
  { toolName: string; company: string; money: boolean; booking: boolean; accent: string }) {
  const outs = [
    `Answers from ${company}'s own pages`,
    ...(booking ? ["Takes the booking"] : []),
    ...(money ? ["Issues a refund, up to the allowance"] : []),
    ...(!booking && !money ? ["Collects the details"] : []),
    "Hands anything else to a person",
  ];
  const W = 680, boxH = 44, gap = 14;
  const H = outs.length * (boxH + gap) - gap + 8;
  const mid = H / 2;
  const box = (x: number, y: number, w: number, text: string, fill: string, stroke: string, color: string, key: string) => (
    <g key={key}>
      <rect x={x} y={y} width={w} height={boxH} rx={6} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text x={x + 12} y={y + boxH / 2 + 5} fontSize={14} fill={color} fontFamily="IBM Plex Sans, system-ui, sans-serif">{text}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`A customer talks to ${toolName}; it answers, resolves, or hands off`}>
      <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8A949A" /></marker></defs>
      {box(0, mid - boxH / 2, 118, "Customer", "#F5F7F6", "#CAD1CE", "#14213D", "c")}
      <line x1={122} y1={mid} x2={240} y2={mid} stroke="#8A949A" strokeWidth={1.5} markerEnd="url(#arr)" />
      {box(246, mid - boxH / 2, 196, toolName, accent, accent, "#FFFFFF", "t")}
      {outs.map((label, i) => {
        const y = i * (boxH + gap) + 4;
        const last = i === outs.length - 1;
        return (
          <g key={label}>
            <path d={`M446,${mid} C 456,${mid} 456,${y + boxH / 2} 466,${y + boxH / 2}`} fill="none" stroke="#8A949A" strokeWidth={1.5} markerEnd="url(#arr)" />
            {box(472, y, 208, label, last ? "#F5F7F6" : "#FFFFFF", last ? "#CAD1CE" : accent, "#14213D", `o${i}`)}
          </g>
        );
      })}
    </svg>
  );
}
