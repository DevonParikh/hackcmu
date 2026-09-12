import type Anthropic from "@anthropic-ai/sdk";
import { completeText, isDemo, MODELS } from "../llm";
import { getTemplate } from "../templates";
import type { KnowledgeChunk, ToolDoc } from "../types";

const STOP = new Set(
  "a an the and or of to in on for with is are be at by from this that it as your our you we my me i do does did can could would should will its their there here about have has had not no yes please thanks take get got give make made some any also just very really much more most other another one two also if then than so too into out up down over under again still only own same very tell know need want like let us them they he she his her what how where when which why who whom whose anything something everything nothing anyone someone available".split(" "),
);

/** Light stemming so "cancellations" meets "cancel" and "hours" meets "hour". */
function stem(t: string): string {
  if (t.length <= 4) return t;
  let w = t;
  if (w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.endsWith("ations") && w.length > 8) w = w.slice(0, -6);
  else if (w.endsWith("ation") && w.length > 7) w = w.slice(0, -5);
  else if (w.endsWith("ing") && w.length > 6) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 5 && !w.endsWith("ses")) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  // "cancellation" and "cancel", "reserve" and "reservation" now meet: drop a trailing e too.
  if (w.length > 5 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length > 4 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9$.\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

export function knowledgeText(chunks: KnowledgeChunk[]): string {
  return chunks.map((c, i) => `### [${i + 1}] ${c.title}\nURL: ${c.url}\n${c.text}`).join("\n\n");
}

/** Common question intents expanded into the words a small-business site uses for them. */
export const INTENTS: [RegExp, string[]][] = [
  [/\b(hours?|open|opening|close|closed|closing|when|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekends?|weekdays?|holidays?)\b/, ["hours", "open", "opening", "closed", "am", "pm", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "weekdays", "weekends"]],
  [/\b(price|prices|pricing|cost|costs|much|fee|fees|rate|rates|charge)\b/, ["price", "prices", "cost", "fee", "fees", "rates", "starting", "$"]],
  [/\b(where|located|location|address|directions|find you|parking)\b/, ["located", "address", "street", "avenue", "road", "suite", "parking", "directions", "map"]],
  [/\b(contact|reach|email|phone|call|number)\b/, ["contact", "email", "phone", "call", "reach"]],
  [/\b(book|booking|appointment|reserve|reservation|schedule)\b/, ["book", "booking", "appointment", "appointments", "reserve", "reservation", "schedule"]],
  [/\b(refund|cancel|cancellation|return|policy|policies)\b/, ["refund", "refunds", "cancel", "cancellation", "policy", "notice", "fee"]],
  [/\b(deliver|delivery|ship|shipping|pickup|pick up)\b/, ["delivery", "deliver", "shipping", "pickup"]],
  [/\b(insurance|insurances|accept|payment|pay|card|cards)\b/, ["insurance", "accept", "payment", "cards", "cash", "financing", "plans"]],
  [/\b(allerg\w*|gluten|vegan|dairy|nuts?|peanuts?|ingredients?|celiac)\b/, ["gluten", "dairy", "nut", "allergen", "allergy", "vegan", "ingredient", "kitchen", "wheat", "egg"]],
  [/\b(wholesale|bulk|catering|events?|corporate)\b/, ["wholesale", "catering", "bulk", "accounts", "events", "minimum"]],
];

interface Sentence {
  chunk: KnowledgeChunk;
  text: string;
  terms: string[];
}

function sentencesOf(chunks: KnowledgeChunk[]): Sentence[] {
  const out: Sentence[] = [];
  for (const chunk of chunks) {
    for (const raw of chunk.text.split(/(?<=[.!?])\s+|\n+/)) {
      const text = raw.trim();
      if (text.length < 12 || text.length > 400) continue;
      out.push({ chunk, text, terms: tokens(text) });
    }
  }
  return out;
}

/**
 * Deterministic retrieval used in demo mode: BM25 over sentences with light intent expansion,
 * so "What are your hours?" prefers "Hours: Tue-Sun 7am to 3pm" over "72 hours notice".
 */
export function retrieve(chunks: KnowledgeChunk[], query: string): { chunk: KnowledgeChunk; sentences: string[]; score: number } | null {
  const base = tokens(query);
  if (!base.length || !chunks.length) return null;
  const lower = query.toLowerCase();
  const matched = INTENTS.filter(([re]) => re.test(lower));
  const expansion = matched.flatMap(([, words]) => words);
  // Words an intent covers ("booking" on a site that says "appointment") count as understood even when the site never uses them.
  const covered = new Set([...expansion.map(stem), ...lower.split(/[^a-z0-9]+/).filter((w) => matched.some(([re]) => re.test(w))).map(stem)]);
  const asksHours = matched.some(([, words]) => words[0] === "hours");
  const weights = new Map<string, number>();
  for (const t of base) weights.set(t, 1);
  for (const t of expansion.map((x) => (x === "$" ? x : stem(x)))) if (!weights.has(t)) weights.set(t, 0.45);
  const sents = sentencesOf(chunks);
  if (!sents.length) return null;
  const N = sents.length;
  const df = new Map<string, number>();
  for (const s of sents) for (const t of new Set(s.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  // A word that appears in most sentences (the business name, "bakery") cannot carry an answer on its own.
  const informative = (t: string) => N < 8 || (df.get(t) ?? 0) / N < 0.3;
  const avgLen = sents.reduce((n, s) => n + s.terms.length, 0) / N;
  const k1 = 1.2, b = 0.75;
  const scored = sents.map((s) => {
    let score = 0;
    const counts = new Map<string, number>();
    for (const t of s.terms) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [t, w] of weights) {
      const tf = t === "$" ? (s.text.includes("$") ? 1 : 0) : (counts.get(t) ?? 0);
      if (!tf) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += w * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * s.terms.length) / avgLen)));
    }
    const priceHit = weights.has("$") && s.text.includes("$") ? 1 : 0;
    const hoursHit = asksHours && /\b(\d{1,2}(:\d{2})?\s?(am|pm)|hours|open|closed|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(s.text) ? 1 : 0;
    const baseHits = base.filter((t) => counts.has(t) && informative(t)).length + priceHit + hoursHit;
    return { s, score: score * (1 + 0.5 * baseHits), baseHits };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  // Never answer on intent vocabulary alone: at least one of the asker's own words must appear,
  // and if the question names something the site never mentions ("bicycles"), one shared word is not enough.
  if (!best || best.score <= 0 || best.baseHits === 0) return null;
  const absent = base.filter((t) => t.length >= 4 && (df.get(t) ?? 0) === 0 && !covered.has(t));
  if (absent.length > 0 && best.baseHits < 2) return null;
  const picked = [best];
  // The second sentence must come from the same page so the citation stays honest.
  const second = scored.slice(1).find((x) => x.score > best.score * 0.55 && x.s.text !== best.s.text && x.s.chunk === best.s.chunk);
  if (second) picked.push(second);
  return { chunk: best.s.chunk, sentences: picked.map((x) => x.s.text.slice(0, 280)), score: best.score };
}

function escalation(tool: ToolDoc): string {
  const c = tool.config.escalation;
  const parts = [c.email && `email ${c.email}`, c.phone && `call ${c.phone}`].filter(Boolean);
  return parts.length ? `You can also ${parts.join(" or ")}.` : "You can also reach us through the contact page.";
}

function hasPhrase(text: string, phrase: string): boolean {
  const esc = phrase.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (esc.length > 0 && new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(text)) return true;
  // "discounts" also blocks "Is there a discount?": every stemmed word of the phrase must appear.
  const need = tokens(phrase);
  if (!need.length) return false;
  const have = new Set(tokens(text));
  return need.every((t) => have.has(t));
}

export async function answerChat(tool: ToolDoc, history: { role: "user" | "assistant"; content: string }[], userMessage: string): Promise<string> {
  const message = userMessage.trim();
  if (!message) return `Type a question and I'll do my best. ${escalation(tool)}`;
  // Off-limits topics are enforced the same way in both modes, so the owner's setting is a rule, not a hint.
  if (tool.config.offLimits.some((o) => hasPhrase(message.toLowerCase(), o))) return `I can't help with that here. ${escalation(tool)}`;
  if (isDemo()) return demoChat(tool, history, message);
  // The API needs alternating turns that start with the user; drop blanks and a leading assistant turn.
  const window = history.filter((m) => m.content.trim()).slice(-12);
  while (window.length && window[0].role !== "user") window.shift();
  const messages: Anthropic.MessageParam[] = [...window.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: message }];
  const reply = await completeText({
    model: MODELS.runtime,
    cachedSystem: `${tool.config.systemPrompt}\n\nKNOWLEDGE:\n${knowledgeText(tool.config.knowledge)}`,
    system: "Answer the latest user message. If you are not sure, say so and share the contact options.",
    messages,
    effort: "low",
    maxTokens: 2000,
  });
  return reply.trim() || `I'm not able to answer that one right now. ${escalation(tool)}`;
}

export async function answerForm(tool: ToolDoc, input: string): Promise<string> {
  if (isDemo()) return demoForm(tool, input);
  const reply = await completeText({
    model: MODELS.runtime,
    cachedSystem: `${tool.config.systemPrompt}\n\nKNOWLEDGE:\n${knowledgeText(tool.config.knowledge)}`,
    system: "Produce the requested output for the input below. Output only the result.",
    messages: [{ role: "user", content: input }],
    effort: "low",
    maxTokens: 2000,
  });
  return reply.trim() || "I couldn't produce a draft for that input. Try adding a little more detail.";
}

/** A message that asks something, as opposed to one that supplies a detail ("Tuesday at 3pm, I'm Sam"). */
export function isQuestion(message: string): boolean {
  const m = message.trim();
  return /\?\s*$/.test(m) || /^(what|how|do|does|did|can|could|where|when|is|are|was|were|which|why|who|will|would|should|any|anything)\b/i.test(m);
}

/** True when a reply hands the customer to a person instead of answering. */
export function isHandOff(tool: ToolDoc, reply: string): boolean {
  const c = tool.config.escalation;
  if (/not sure|couldn't find|can't find|don't have that|one for a person|can't help with that|not able to answer|confirm with a person|can't see the calendar|don't have .{0,30}(details|information)|isn't something i can|beyond what i can|outside what i can|a person (on|from) (our|the) team/i.test(reply)) return true;
  // Contact details alone are not a hand-off ("You can call us at…" answers a contact question);
  // they are one when paired with uncertainty. Phone numbers are compared by digits so reformatting cannot hide one.
  const digits = (s: string) => s.replace(/\D/g, "");
  const hasContact = !!((c.email && reply.toLowerCase().includes(c.email.toLowerCase())) || (c.phone && digits(c.phone).length >= 7 && digits(reply).includes(digits(c.phone))));
  return hasContact && /\b(sorry|not sure|unsure|don't have|do not have|can't|cannot|unable|couldn't|no information|please contact|reach out|recommend contacting|best to (ask|contact|call)|get in touch|directly|check with)\b/i.test(reply);
}

/**
 * Answers location, contact, and "what do you do" questions from structured facts, which beat sentence search.
 * Only when the message is about nothing else: "Do you offer phone support?" is not a request for the phone number.
 */
function factAnswer(tool: ToolDoc, lower: string): string | null {
  const c = tool.config.escalation;
  if (/\b(what do you (do|offer|sell|make|provide)|tell me about|who are you|what is this|what kind of)\b/.test(lower) && tool.config.about) {
    return tool.config.about;
  }
  if (/\b(what|which) (services|products|treatments|items)\b|\b(services|products|treatments) (do|does) .{0,60}(offer|provide|sell)\b/.test(lower)) {
    const page = tool.config.knowledge.find((k) => /\b(services?|products?|menu|treatments?|what we (do|offer))\b/i.test(k.title) || /\/(services?|products?|menu|treatments?)\b/i.test(k.url));
    if (page) {
      const items = page.text.split(/\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length >= 4 && x.length <= 120 && !/^(services?|products?|menu|treatments?)$/i.test(x)).slice(0, 4);
      if (items.length) return `Here's what we offer: ${items.join("; ")}. (Source: ${page.title})`;
    }
  }
  const CONTACT_WORDS = new Set(["contact", "reach", "phone", "email", "call", "number", "touch", "located", "location", "address", "direction", "find", "park", "parking", "you", "your", "get"]);
  const others = tokens(lower).filter((t) => !CONTACT_WORDS.has(t) && !CONTACT_WORDS.has(t + "e"));
  if (others.length > 0) return null;
  const asksWhere = /\b(where|located|location|address|directions|find you)\b/.test(lower);
  const asksContact = /\b(contact|reach|phone|email|call|number|get in touch)\b/.test(lower);
  if (asksWhere && c.address) {
    const extra = retrieve(tool.config.knowledge, "parking directions " + lower);
    const parking = extra?.sentences.find((x) => /parking|directions|bus|garage/i.test(x));
    return `We're located at ${c.address}.${parking ? " " + parking : ""}`;
  }
  if (asksContact && (c.email || c.phone)) {
    const parts = [c.phone && `call ${c.phone}`, c.email && `email ${c.email}`].filter(Boolean);
    return `You can ${parts.join(" or ")}.${c.address ? ` We're at ${c.address}.` : ""}`;
  }
  return null;
}

/** "From our site" for pages; an uploaded file is named ("From our holiday policies") so customers are not told it is on the website. */
function fromLabel(chunk: KnowledgeChunk): string {
  if (chunk.kind !== "user") return "From our site:";
  const t = chunk.title.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").trim().toLowerCase();
  return t && t !== "notes you added" ? `From our ${t}:` : "From our notes:";
}

function demoChat(tool: ToolDoc, history: { role: "user" | "assistant"; content: string }[], userMessage: string): string {
  const t = getTemplate(tool.templateId);
  const name = tool.config.name;
  const hit = retrieve(tool.config.knowledge, userMessage);
  const lower = userMessage.toLowerCase();
  if (tool.config.offLimits.some((o) => hasPhrase(lower, o))) return `I can't help with that here. ${escalation(tool)}`;
  // A question about a policy is answered from the site; a request for a refund or a complaint goes to a person.
  const policyQuestion = /\b(policy|policies|how (do|can) i|what (is|are) your|can i cancel|cancellation)\b/.test(lower);
  const wantsHuman =
    /\b(complain|complaint|lawsuit|emergency|manager|speak to|talk to|real person|human)\b/.test(lower) ||
    (/\b(refund|return my|cancel my|my order|my appointment)\b/.test(lower) && !policyQuestion) ||
    /\b(medical|legal) advice\b/.test(lower);
  if (wantsHuman) return `That's one for a person on our team. ${escalation(tool)}`;
  if (t?.id === "lead_intake" || t?.id === "booking_intake") {
    // Slots are judged over the whole conversation, so the bot remembers earlier answers.
    // A short reply to "Could you share your name?" is the name, even without "my name is".
    const lastAsk = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
    const bareName = /your name/i.test(lastAsk) && /^[A-Za-z][A-Za-z'.-]*( [A-Za-z][A-Za-z'.-]*){0,2}$/.test(userMessage.trim());
    const said = [...history.filter((m) => m.role === "user").map((m) => m.content), bareName ? `my name is ${userMessage.trim()}` : userMessage].join("\n").toLowerCase();
    const slots: { ask: string; test: RegExp }[] =
      t.id === "lead_intake"
        ? [
            { ask: "your name", test: /\b(my name is|i'm|i am|this is|name:)\s+[a-z]/i },
            { ask: "what you need", test: /\b(need|looking for|want|interested in|quote for|help with)\b/i },
            { ask: "when you need it", test: /\b(today|tomorrow|next (week|month)|this (week|month)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|asap|by (the )?\d|on the \d|\d{1,2}(st|nd|rd|th)|(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}|\d{1,2}\/\d{1,2})\b/i },
            { ask: "a rough budget", test: /\$\s?\d|\b(budget|around \d|up to \d|dollars)\b/i },
            { ask: "the best way to reach you", test: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\b(call me|email me|text me)\b/i },
          ]
        : [
            { ask: tool.config.bookingKind === "order" ? "what you'd like to order" : tool.config.bookingKind === "reservation" ? "how many people it is for" : "the service you'd like", test: /\b(book|appointment|table|for \d+ people|for (two|three|four|five|six)\b|cleaning|consultation|session|class|cake|order|haircut|checkup|reservation|room|visit|party of)\b/i },
            { ask: "a preferred date and time (plus one alternative)", test: /\b(\d{1,2}(:\d{2})?\s?(am|pm)|noon|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next week)\b/i },
            { ask: "your name", test: /\b(my name is|i'm|i am|this is|name:)\s+[a-z]/i },
            { ask: "a phone number or email", test: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i },
          ];
    const next = slots.find((sl) => !sl.test.test(said)) ?? null;
    const company = tool.config.companyName || name;
    // A question gets an answer first (from the structured facts or the site); when the site has none,
    // say so and let a person confirm. A message that only supplies details is acknowledged.
    let direct = "";
    if (isQuestion(userMessage)) {
      if (/\b(availab\w*|free (slot|spot|table)|slots?|spots?|openings?|fully booked|any space|any room)\b/.test(lower) && t.id === "booking_intake") {
        direct = "I can't see the calendar from here, but a person will confirm availability once I have your details.";
      } else {
        direct = factAnswer(tool, lower) ?? (hit && hit.sentences.length && hit.score >= 2 ? `${fromLabel(hit.chunk)} ${hit.sentences[0]}` : `I couldn't find that on our site, so a person from ${company} will confirm it with you.`);
      }
    }
    if (!next) return `${direct ? direct + " " : ""}Thanks, I have what I need. Someone from ${company} will confirm with you. ${escalation(tool)}`;
    return `${direct ? direct + " " : "Got it. "}Could you share ${next.ask}?`;
  }
  const fact = factAnswer(tool, lower);
  if (fact) return fact;
  const allergy = /\b(allerg\w*|gluten|celiac|nut|nuts|peanut|dairy|vegan|intoleran\w*)\b/.test(lower);
  if (!hit || !hit.sentences.length) {
    return allergy
      ? `I don't have allergen details for that on our site, and this is one to confirm with a person before ordering. ${escalation(tool)}`
      : `I couldn't find that on our site yet. ${escalation(tool)}`;
  }
  const safety = allergy ? " Please confirm with us directly before ordering if you have an allergy." : "";
  return `${hit.sentences.join(" ")} (Source: ${hit.chunk.title})${safety}`;
}

function demoForm(tool: ToolDoc, input: string): string {
  const company = tool.config.companyName || tool.config.name;
  if (tool.templateId === "review_responder") {
    if (tool.config.offLimits.some((o) => hasPhrase(input.toLowerCase(), o))) return `This one is best handled by a person. ${escalation(tool)}`;
    const neg = (input.match(/\b(disappoint\w*|never|waited|wait|slow|rude|bad|terrible|awful|confus\w*|cold|wrong|dirty|overpriced|pricey|expensive|nobody|no one|unhelpful|poor|worst|late|mistake|refund)\b|\b[12] stars?\b|\btwo stars?\b|\bone star\b/gi) || []).length;
    const pos = (input.match(/\b(great|love\w*|excellent|friendly|amazing|best|delicious|perfect|wonderful|fantastic|helpful|quick|recommend\w*|clean|professional|thank you|five stars|5 stars)\b/gi) || []).length;
    const butNeg = /\bbut\b[^.!?]*\b(pricey|expensive|slow|late|small|hard|difficult|confus\w*|wait\w*|not|no)\b/i.test(input);
    const quote = input.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0].slice(0, 90);
    if (neg > pos || butNeg) {
      return `Thank you for taking the time to tell us this. We're sorry the experience fell short: "${quote}" is not the standard we hold ourselves to, and we'd like to make it right. Please reach us directly so we can talk it through. ${escalation(tool)} — ${company}`;
    }
    if (neg === 0 && pos === 0) {
      return `Thank you for the honest feedback. We read every review, and yours helps us see what to improve. If anything would have made your visit better, we'd love to hear it. ${escalation(tool)} — ${company}`;
    }
    return `Thank you so much for the kind words! Hearing "${quote}" made our day, and we'll pass it along to the team. We look forward to seeing you again soon. — ${company}`;
  }
  if (tool.templateId === "listing_writer") {
    // Only the facts given: no filler, no invented claims.
    const parts = input.split(/,|\n|;/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return "Give me the product facts (name, what it is made of, size, price, who it is for) and I'll write the listing.";
    const title = parts[0].slice(0, 70);
    const price = parts.find((p) => /\$\s?\d/.test(p));
    const facts = parts.slice(1).filter((p) => p !== price);
    const sentence = facts.length ? `${title} from ${company}: ${facts.join(", ")}.` : `${title} from ${company}.`;
    const bullets = [...facts, ...(price ? [price] : [])].slice(0, 3).map((f) => `- ${f}`);
    return `Title: ${title}\n\nDescription: ${sentence}${price ? ` ${price}.` : ""}\n\nHighlights:\n${bullets.length ? bullets.join("\n") : "- (add materials, size, or who it is for to get highlights)"}`;
  }
  return demoChat(tool, [], input);
}
