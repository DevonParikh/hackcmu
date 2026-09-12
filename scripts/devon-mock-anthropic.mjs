// A stand-in for the Anthropic Messages API so the live-mode code paths can be exercised
// without a key. It answers structured-output requests with a schema-valid object, tool
// requests with plain notes, and everything else with a short text. Not a model: it
// proves the plumbing (request shapes, parsing, stop reasons), not the quality.
//
//   node scripts/mock-anthropic.mjs            # listens on 127.0.0.1:3999
//   ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:3999 npm start
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 3999);
let calls = 0;

let ROOT = null;
function resolve(schema) {
  if (schema && schema.$ref && ROOT) {
    const path = schema.$ref.replace(/^#\//, "").split("/");
    let cur = ROOT;
    for (const p of path) cur = cur?.[p];
    return cur ?? schema;
  }
  return schema;
}

// The SDK moves constraints the API schema subset lacks (enum, minItems, ...) into the description.
function constraints(schema) {
  const out = {};
  const d = typeof schema?.description === "string" ? schema.description : "";
  const m = d.match(/\{([^{}]*)\}\s*$/);
  if (!m) return out;
  for (const part of m[1].split(/,(?![^\[]*\])/)) {
    const kv = part.match(/^\s*(\w+):\s*(.+)\s*$/);
    if (!kv) continue;
    try {
      out[kv[1]] = JSON.parse(kv[2]);
    } catch {
      out[kv[1]] = kv[2];
    }
  }
  return out;
}

function sample(schema, key = "", depth = 0) {
  schema = resolve(schema);
  if (!schema || depth > 8) return null;
  const c = constraints(schema);
  if (schema.anyOf) return sample(schema.anyOf.find((s) => resolve(s).type !== "null") ?? schema.anyOf[0], key, depth + 1);
  if (schema.enum || c.enum) return (schema.enum || c.enum)[0];
  switch (schema.type) {
    case "object": {
      const out = {};
      const props = schema.properties || {};
      const required = new Set(schema.required || Object.keys(props));
      for (const [k, v] of Object.entries(props)) if (required.has(k) || Math.random() < 0.5) out[k] = sample(v, k, depth + 1);
      return out;
    }
    case "array": {
      const min = schema.minItems ?? c.minItems ?? 1;
      const max = schema.maxItems ?? c.maxItems ?? 3;
      const n = Math.max(1, Math.min(Math.max(min, 1), max));
      return Array.from({ length: n }, (_, i) => sample(schema.items, key, depth + 1) ?? `item ${i + 1}`);
    }
    case "string": {
      if (/url/i.test(key)) return "https://example.com/";
      if (/id$/i.test(key)) return "sample_id";
      if (/quote/i.test(key)) return "Open Tuesday to Sunday";
      if (/note|rationale|summary|why|offering|tagline/i.test(key)) return `Mock ${key}: written from the sources provided.`;
      return `mock ${key || "text"}`;
    }
    case "number":
    case "integer":
      return Math.max(schema.minimum ?? c.minimum ?? 1, 1);
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      return schema.type === undefined && schema.properties ? sample({ ...schema, type: "object" }, key, depth) : null;
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "mock: unknown route" } }));
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    let params = {};
    try {
      params = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "mock: bad JSON" } }));
    }
    const format = params.output_config?.format;
    let text;
    if (format?.schema) {
      ROOT = format.schema;
      text = JSON.stringify(sample(format.schema));
    } else if (Array.isArray(params.tools) && params.tools.some((t) => /web_search|web_fetch/.test(t.type || ""))) {
      text = "Research notes (mock): Competitor A at https://example.com/ offers online booking and live chat; competitor B at https://example.org/ publishes prices.";
    } else {
      const last = [...(params.messages || [])].reverse().find((m) => m.role === "user");
      const q = typeof last?.content === "string" ? last.content : "";
      text = `Mock reply to: ${q.slice(0, 80)}. You can reach us through the contact page.`;
    }
    const reply = {
      id: `msg_mock_${calls}`,
      type: "message",
      role: "assistant",
      model: params.model || "mock",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: Math.ceil(body.length / 4), output_tokens: Math.ceil(text.length / 4) },
    };
    console.log(`[mock] #${calls} ${params.model} format=${format ? "json" : "-"} tools=${(params.tools || []).map((t) => t.type || t.name).join(",") || "-"} cache=${JSON.stringify(params.system ?? "").includes("cache_control")}`);
    res.writeHead(200, { "content-type": "application/json", "request-id": `mock-${calls}` });
    res.end(JSON.stringify(reply));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock Anthropic API on http://127.0.0.1:${PORT}`));
