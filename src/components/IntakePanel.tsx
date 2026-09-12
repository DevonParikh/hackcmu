"use client";

import { useState } from "react";
import type { Intake } from "@/lib/types";

const SHARE = [
  ["", "Choose…"],
  ["most", "Most of them (about 3 in 4)"],
  ["half", "About half"],
  ["some", "Some (about 1 in 4)"],
  ["unsure", "Not sure"],
];
const MINUTES = [
  ["", "Choose…"],
  ["under2", "Under 2 minutes"],
  ["2to5", "2 to 5 minutes"],
  ["5to10", "5 to 10 minutes"],
  ["10to20", "10 to 20 minutes"],
  ["over20", "More than 20 minutes"],
  ["unsure", "Not sure"],
];
const REPLY = [
  ["", "Choose…"],
  ["1h", "Within an hour"],
  ["fewHours", "A few hours"],
  ["sameDay", "Same day"],
  ["nextDay", "Next business day"],
  ["2to3days", "2 to 3 days"],
  ["longer", "Longer"],
  ["unsure", "Not sure"],
];

type SourceMeta = { id: string; title: string; kind: string; audience: string | null };

export function IntakePanel({ runId, intake, sources, showItems, onSaved }: { runId: string; intake: Intake; sources: SourceMeta[]; showItems: boolean; onSaved: () => Promise<unknown> }) {
  const [files, setFiles] = useState<{ file: File; audience: "public" | "staff" }[]>([]);
  const [topQuestions, setTopQuestions] = useState(intake.topQuestions.join("\n"));
  const [notes, setNotes] = useState("");
  const [inquiries, setInquiries] = useState(intake.inquiriesPerWeek?.toString() ?? "");
  const [share, setShare] = useState(intake.routineShare ?? "");
  const [minutes, setMinutes] = useState(intake.minutesPerInquiry ?? "");
  const [reply, setReply] = useState(intake.replyTime ?? "");
  const [hourValue, setHourValue] = useState(intake.hourValue?.toString() ?? "");
  const [items, setItems] = useState(intake.itemsPerMonth?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const uploaded = sources.filter((s) => s.kind === "user");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      for (const f of files) {
        fd.append("files", f.file);
        fd.append("audience", f.audience);
      }
      fd.set("topQuestions", topQuestions);
      fd.set("notes", notes);
      fd.set("inquiriesPerWeek", inquiries);
      fd.set("routineShare", share);
      fd.set("minutesPerInquiry", minutes);
      fd.set("replyTime", reply);
      fd.set("hourValue", hourValue);
      fd.set("itemsPerMonth", items);
      const res = await fetch(`/api/runs/${runId}/intake`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setFiles([]);
      setNotes("");
      setMsg({ kind: "ok", text: data.documents ? `Saved. ${data.documents} document${data.documents === 1 ? "" : "s"} added; the report below has been updated.` : "Saved. The report below has been updated." });
      await onSaved();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="panel grid gap-5 p-5" id="intake">
      <div>
        <p className="eyebrow">Add what you know</p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Everything here is optional. Files fill gaps in the grid above; the numbers turn evidence into hours. Nothing is guessed for you.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <label className="text-sm font-semibold" htmlFor="intake-files">
            Documents customers ask about
          </label>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Menu, price list, policies, FAQ, or staff instructions. PDF or text, up to 10 MB each.
          </p>
          <input
            id="intake-files"
            type="file"
            multiple
            accept=".pdf,.txt,.md,.csv,.json,.html,.htm,text/plain,application/pdf"
            className="text-sm"
            onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? []).map((file) => ({ file, audience: "public" as const }))])}
          />
          {files.length > 0 && (
            <ul className="grid gap-1 text-sm">
              {files.map((f, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="truncate">{f.file.name}</span>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={f.audience === "public"} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, audience: e.target.checked ? "public" : "staff" } : x)))} />
                    customers may see this
                  </label>
                  <button type="button" className="text-xs underline" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {uploaded.length > 0 && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Already added: {uploaded.map((u) => `${u.title}${u.audience === "staff" ? " (staff only)" : ""}`).join(", ")}
            </p>
          )}
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Anything else customers should know</span>
            <textarea id="intake-notes" className="input" rows={2} placeholder="e.g. We close at noon on Christmas Eve. Cash only under $5." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">The 3 to 5 questions customers ask you most</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              One per line, in their words. We test the assistant on these first.
            </span>
            <textarea id="intake-questions" className="input" rows={5} placeholder={"Do you have gluten-free options?\nCan I book for a group?"} value={topQuestions} onChange={(e) => setTopQuestions(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Customer questions or requests in a normal week</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            By phone, email, messages, or walk-in. A rough guess is fine.
          </span>
          <input id="intake-inquiries" className="input" inputMode="numeric" placeholder="e.g. 40" value={inquiries} onChange={(e) => setInquiries(e.target.value.replace(/[^\d]/g, ""))} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">How many are the same handful of questions?</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Hours, prices, policies, how to book.
          </span>
          <select id="intake-share" className="input" value={share} onChange={(e) => setShare(e.target.value as typeof share)}>
            {SHARE.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">How long one usually takes to deal with</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Including finding the answer and replying.
          </span>
          <select id="intake-minutes" className="input" value={minutes} onChange={(e) => setMinutes(e.target.value as typeof minutes)}>
            {MINUTES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">How long until someone hears back today?</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            When they email or leave a voicemail during opening hours.
          </span>
          <select id="intake-reply" className="input" value={reply} onChange={(e) => setReply(e.target.value as typeof reply)}>
            {REPLY.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">What an hour of that time is worth ($, optional)</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Leave blank to see hours only, never dollars.
          </span>
          <input id="intake-hour" className="input" inputMode="numeric" placeholder="e.g. 30" value={hourValue} onChange={(e) => setHourValue(e.target.value.replace(/[^\d]/g, ""))} />
        </label>
        {showItems && (
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Reviews or new products in a month</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              For the drafting tools.
            </span>
            <input id="intake-items" className="input" inputMode="numeric" placeholder="e.g. 12" value={items} onChange={(e) => setItems(e.target.value.replace(/[^\d]/g, ""))} />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and update the report"}
        </button>
        {msg && (
          <span className="text-sm" style={{ color: msg.kind === "ok" ? "var(--good)" : "var(--bad)" }}>
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
