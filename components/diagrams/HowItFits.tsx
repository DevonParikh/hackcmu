// D1 — How it fits. Customer → the tool → three outcomes. One SVG with slots; no diagram library.
// Server-safe: no hooks.

export default function HowItFits({ toolName, company, money, booking }:
  { toolName: string; company: string; money: boolean; booking: boolean }) {
  const outs = [
    { label: `Answers from ${company}'s own pages`, on: true },
    { label: booking ? "Takes the booking" : money ? "Issues a refund, up to the allowance" : "Collects the details", on: true },
    { label: `Hands anything else to a person`, on: true },
  ];
  if (money && booking) outs.splice(2, 0, { label: "Issues a refund, up to the allowance", on: true });
  const W = 680, boxH = 44, gap = 16, colX = [0, 250, 470], outY = 0;
  const H = outs.length * (boxH + gap) - gap;
  const midY = H / 2;
  const box = (x: number, y: number, w: number, text: string, fill: string, stroke: string, color: string) => (
    <g key={text}>
      <rect x={x} y={y} width={w} height={boxH} rx={6} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text x={x + 12} y={y + boxH / 2 + 5} fontSize={14} fill={color}>{text}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H + 8}`} width="100%" role="img" aria-label={`Customer talks to ${toolName}; it answers, resolves, or hands off`}>
      <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#5F6B72" /></marker></defs>
      {box(colX[0], midY - boxH / 2 + 4, 120, "Customer", "#F5F7F6", "#C3CBC8", "#14213D")}
      <line x1={124} y1={midY + 4} x2={244} y2={midY + 4} stroke="#5F6B72" strokeWidth={1.5} markerEnd="url(#arr)" />
      {box(colX[1], midY - boxH / 2 + 4, 200, toolName, "#14213D", "#14213D", "#FFFFFF")}
      {outs.map((o, i) => {
        const y = outY + i * (boxH + gap) + 4;
        return (
          <g key={o.label}>
            <path d={`M454,${midY + 4} C 462,${midY + 4} 462,${y + boxH / 2} 468,${y + boxH / 2}`} fill="none" stroke="#5F6B72" strokeWidth={1.5} markerEnd="url(#arr)" />
            {box(colX[2], y, 208, o.label, i === outs.length - 1 ? "#F5F7F6" : "#E8F1EC", i === outs.length - 1 ? "#C3CBC8" : "#2E7D5B", "#14213D")}
          </g>
        );
      })}
    </svg>
  );
}
