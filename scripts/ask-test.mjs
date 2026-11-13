// Asks one question through the running dev server, exactly as the Ask screen
// does, and prints what came back – so answers can be checked without a browser.
//
//   npm run dev                                   (in another terminal)
//   npm run ask:test -- "What's our typical cost for London to Manchester?"
//
// Prints the tool calls, the answer, the "Quotes used" list (built from the
// tool results, like the screen), a check that every £ and % figure in the
// answer appears in a tool result the model saw, and the token cost.
// Each run is one question (one model call chain) – keep to the test budget.
//
// Options (environment): APP_URL (default http://localhost:3000),
// PRICE_IN_PER_M / PRICE_OUT_PER_M / PRICE_CACHED_IN_PER_M (USD per 1M tokens).
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
// gpt-6.1-sol standard prices, as in scripts/agent-test.mjs.
const PRICE = {
  input: Number(process.env.PRICE_IN_PER_M ?? 2),
  cached: Number(process.env.PRICE_CACHED_IN_PER_M ?? 0.1),
  output: Number(process.env.PRICE_OUT_PER_M ?? 10),
};

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run ask:test -- "your question"');
  process.exit(1);
}

const started = Date.now();
const res = await fetch(`${APP_URL}/api/ask`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ id: "q1", role: "user", parts: [{ type: "text", text: question }] }] }),
});
if (!res.ok || !res.body) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

let answer = "";
let usage = null;
const calls = new Map(); // toolCallId → { name, input, output }
let buffer = "";
const decoder = new TextDecoder();
for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let cut;
  while ((cut = buffer.indexOf("\n\n")) >= 0) {
    const event = buffer.slice(0, cut);
    buffer = buffer.slice(cut + 2);
    const data = event.replace(/^data: ?/gm, "").trim();
    if (!data || data === "[DONE]") continue;
    let part;
    try {
      part = JSON.parse(data);
    } catch {
      continue;
    }
    if (part.type === "text-delta") answer += part.delta ?? "";
    else if (part.type === "tool-input-available") calls.set(part.toolCallId, { name: part.toolName, input: part.input });
    else if (part.type === "tool-output-available") {
      const call = calls.get(part.toolCallId) ?? { name: "?", input: {} };
      call.output = part.output;
      calls.set(part.toolCallId, call);
    } else if (part.type === "error") console.error("Stream error:", part.errorText);
    if (part.messageMetadata) usage = part.messageMetadata;
  }
}

console.log(`\nQ: ${question}\n`);
console.log("Tools:");
if (calls.size === 0) console.log("  (none)");
for (const c of calls.values()) console.log(`  ${c.name} ${JSON.stringify(c.input)}`);

console.log(`\nAnswer:\n${answer.trim().replace(/^/gm, "  ")}\n`);

const sources = new Map();
const lists = [];
let seen = "";
for (const c of calls.values()) {
  const { sources: s = [], lists: l = [], ...rest } = c.output ?? {};
  for (const q of s) if (!sources.has(q.id)) sources.set(q.id, q);
  for (const name of l) if (!lists.includes(name)) lists.push(name);
  seen += JSON.stringify(rest);
}
console.log(`Quotes used (${sources.size}):`);
for (const s of [...sources.values()].slice(0, 12)) {
  console.log(`  ${s.supplier} – ${s.detail}${s.href ? `  [Open ${s.href}]` : "  [upload, no link]"}`);
}
if (sources.size > 12) console.log(`  … and ${sources.size - 12} more`);
if (lists.length) console.log(`From price lists: ${lists.join(" and ")}`);

// Every £ and % figure in the answer must appear in what the tools returned.
const figures = [...new Set(answer.match(/£[\d,]+(?:\.\d{1,2})?|\d+(?:\.\d+)?%/g) ?? [])];
const missing = figures.filter((f) => !seen.includes(f));
console.log(
  `\nFigures check: ${figures.length} figure(s) in the answer` +
    (missing.length ? ` – NOT FOUND in tool results: ${missing.join(", ")}` : figures.length ? " – all found in tool results" : ""),
);

if (usage) {
  const cost =
    ((usage.input_tokens - usage.cached_input_tokens) * PRICE.input +
      usage.cached_input_tokens * PRICE.cached +
      usage.output_tokens * PRICE.output) /
    1e6;
  console.log(
    `Tokens: ${usage.input_tokens.toLocaleString()} in (${usage.cached_input_tokens.toLocaleString()} cached), ` +
      `${usage.output_tokens.toLocaleString()} out   Estimated cost: $${cost.toFixed(4)}   Time: ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}
