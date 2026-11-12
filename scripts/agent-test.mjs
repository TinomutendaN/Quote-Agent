// Runs the agent on sample files through the running dev server and prints
// what it saved, so results can be checked against public/samples/README.md.
//
//   npm run dev                      (in another terminal)
//   npm run agent:test -- all        (the inbox, one queue per supplier, in parallel)
//   npm run agent:test -- 10 17 18   (just these files, one after another)
//
// Both start the shared run first (POST /api/run), exactly like Process inbox,
// so after a finished run reset with `npm run db:setup`. `all` only sends files
// that are still waiting, so it also carries on a stalled run.
//
// Options (environment): APP_URL (default http://localhost:3000),
// PRICE_IN_PER_M / PRICE_OUT_PER_M / PRICE_CACHED_IN_PER_M (USD per million
// tokens, for the cost estimate).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { MAX_PARALLEL_FILES, buildInboxQueues, runQueues } from "../lib/agent/queues.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const MAX_DURATION_S = 300; // keep in step with app/api/agent/route.ts
// gpt-6.1-sol standard prices, short context (USD per 1M tokens, checked
// 12 Nov 2026 on OpenAI's pricing page). Override with env if they change
// or when testing with AI_PROVIDER=anthropic.
const PRICE = {
  input: Number(process.env.PRICE_IN_PER_M ?? 2),
  cached: Number(process.env.PRICE_CACHED_IN_PER_M ?? 0.1),
  output: Number(process.env.PRICE_OUT_PER_M ?? 10),
};

const db = neon(process.env.DATABASE_URL);

// Short network drops (database or model provider unreachable) should not end
// a test run: such failures are retried. Anything else fails straight away.
const NETWORK_ERROR = /fetch failed|connect timeout|cannot connect|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function sql(strings, ...values) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db(strings, ...values);
    } catch (e) {
      if (attempt >= 5 || !NETWORK_ERROR.test(`${e.message} ${e.sourceError?.cause?.code ?? ""}`)) throw e;
      console.log(`  (database unreachable, retrying in 15 s – attempt ${attempt})`);
      await wait(15000);
    }
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npm run agent:test -- all | <file numbers…>");
  process.exit(1);
}

// Start (or take over) the shared run first, exactly as Process inbox will:
// a takeover puts stuck files back to waiting, so the file list must be read
// after this call.
const start = await (await fetch(`${APP_URL}/api/run`, { method: "POST" })).json();
if (!start.started) {
  console.error(`Run not started: ${start.message ?? start.error}`);
  console.error(`State: ${JSON.stringify(start.state)}`);
  console.error("Reset with `npm run db:setup` to run again.");
  process.exit(1);
}

const files = await sql`
  SELECT id, supplier_id, file_name, type, is_held_back, is_upload, status,
         received_at::text AS received_at
  FROM source_files ORDER BY received_at, id`;

let queues;
if (args[0] === "all") {
  queues = buildInboxQueues(files);
} else {
  const chosen = args.map((n) => {
    const f = files.find((x) => x.file_name.startsWith(n.padStart(2, "0") + "_"));
    if (!f) {
      console.error(`No sample file numbered ${n}.`);
      process.exit(1);
    }
    return f;
  });
  queues = [{ key: "chosen", files: chosen }];
}
const fileCount = queues.reduce((n, q) => n + q.files.length, 0);

console.log(
  `Run ${start.took_over ? "taken over (previous run had stalled)" : "started"}.` +
    (start.reset_file_ids.length ? ` Files reset from working to waiting: ${start.reset_file_ids.join(", ")}.` : "") +
    `\n${fileCount} file(s) in ${queues.length} queue(s), up to ${MAX_PARALLEL_FILES} at once:`,
);
for (const q of queues) console.log(`  ${q.key.padEnd(11)} ${q.files.map((f) => f.file_name.slice(0, 2)).join(" → ")}`);

const pad = (s, n) => String(s).padEnd(n);
const summary = [];

/** One request to the agent route; returns its finish or error event. */
async function runFile(file, out) {
  let finish = null;
  let error = null;
  try {
    const res = await fetch(`${APP_URL}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_file_id: file.id, run_id: start.run_id }),
    });
    if (res.status === 409) {
      const body = await res.json();
      return { finish, error: { message: "Refused by the route", detail: body.error } };
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "step") {
          out.push(
            `  ${String(ev.step).padStart(3)}. ${pad(ev.tool, 17)} ${String(ev.duration_ms).padStart(6)} ms  ${ev.ok ? "" : "[REFUSED] "}${ev.text}`,
          );
        } else if (ev.type === "finish") finish = ev;
        else if (ev.type === "error") error = ev;
      }
    }
  } catch (e) {
    error = { message: "Could not reach the agent route (is `npm run dev` running?)", detail: e.message };
  }
  return { finish, error };
}

/** Runs one file (with network retries) and prints its whole report at once. */
async function processFile(file) {
  const out = [`\n${"=".repeat(100)}\n${file.file_name}  (id ${file.id}, ${file.type})\n${"=".repeat(100)}`];
  const started = Date.now();
  const startedAt = new Date(started).toISOString().slice(11, 19);
  let finish = null;
  let error = null;
  let retries = 0;
  for (;;) {
    ({ finish, error } = await runFile(file, out));
    if (!error || retries >= 3 || !NETWORK_ERROR.test(error.detail ?? "")) break;
    retries++;
    out.push(`\n  !! Network drop (${error.detail.slice(0, 90)}…) – retrying this file in 30 s (retry ${retries})\n`);
    await wait(30000);
  }
  const wallMs = Date.now() - started;

  if (error) {
    out.push(`\n  !! ERROR: ${error.message}\n     ${error.detail}`);
  } else if (finish) {
    out.push(`\n  Summary from the model: ${finish.summary}`);
  } else {
    error = { message: "Stream ended without a finish event", detail: "" };
    out.push(`\n  !! ERROR: ${error.message}`);
  }

  const lines = await sql`
    SELECT id, route, category, rule_number, price::text AS price, unit_note, vat_note, time_slot, goods
    FROM quote_lines WHERE source_file_id = ${file.id} AND NOT is_history ORDER BY id`;
  out.push(`\n  Lines saved (${lines.length}):`);
  for (const l of lines) {
    out.push(
      `    #${pad(l.id, 4)} ${pad(l.route, 40)} ${pad(l.category ?? "(unsorted)", 13)} rule ${l.rule_number ?? "-"}  £${pad(l.price, 8)} ${pad(l.time_slot, 9)} ${pad(l.goods, 15)} ${l.unit_note}; ${l.vat_note}`,
    );
  }

  const reviews = await sql`
    SELECT r.reason_type, r.quote_line_id, r.reason_text, r.original_excerpt, r.usual_price::text AS usual_price, r.suggestion
    FROM review_items r WHERE r.source_file_id = ${file.id} ORDER BY r.id`;
  out.push(`\n  Review items (${reviews.length}):`);
  for (const r of reviews) {
    out.push(`    - ${r.reason_type}${r.quote_line_id ? ` (line #${r.quote_line_id})` : " (whole file)"}: ${r.reason_text}`);
    out.push(`      original: "${r.original_excerpt}"`);
    out.push(`      usual: ${r.usual_price ?? "-"}   suggestion: ${r.suggestion}`);
  }
  console.log(out.join("\n"));

  summary.push({
    file: file.file_name.slice(0, 38),
    result: error ? "ERROR" : finish.status,
    lines: lines.length,
    reviews: reviews.map((r) => r.reason_type).join(", ") || "-",
    model_steps: finish?.model_steps ?? "-",
    net_retries: retries,
    started: startedAt,
    seconds: Math.round(wallMs / 100) / 10,
    in_tokens: finish?.usage.input_tokens ?? 0,
    cached: finish?.usage.cached_input_tokens ?? 0,
    out_tokens: finish?.usage.output_tokens ?? 0,
  });
  // A failed file stops its supplier's queue, so later quotes never overtake it.
  return !error;
}

const runStarted = Date.now();
await runQueues(queues, (file) => processFile(file));
const runSeconds = Math.round((Date.now() - runStarted) / 1000);

console.log(`\n${"=".repeat(100)}\nSUMMARY\n`);
summary.sort((a, b) => a.file.localeCompare(b.file));
console.table(summary);

const tot = summary.reduce(
  (a, s) => ({
    lines: a.lines + s.lines,
    in: a.in + s.in_tokens,
    cached: a.cached + s.cached,
    out: a.out + s.out_tokens,
    secs: a.secs + s.seconds,
  }),
  { lines: 0, in: 0, cached: 0, out: 0, secs: 0 },
);
const cost =
  ((tot.in - tot.cached) * PRICE.input + tot.cached * PRICE.cached + tot.out * PRICE.output) / 1e6;
console.log(
  `Files: ${summary.length}   Lines saved: ${tot.lines}   Wall-clock time: ${runSeconds} s   (sum of file times: ${Math.round(tot.secs)} s)`,
);
console.log(
  `Tokens: ${tot.in.toLocaleString()} in (${tot.cached.toLocaleString()} cached), ${tot.out.toLocaleString()} out` +
    `   Estimated cost: $${cost.toFixed(3)} (at $${PRICE.input}/$${PRICE.cached}/$${PRICE.output} per 1M in/cached/out)`,
);

const reasons = await sql`
  SELECT reason_type, count(*)::int AS n FROM review_items WHERE status = 'open' GROUP BY reason_type ORDER BY reason_type`;
console.log(`Open review items in database: ${reasons.map((r) => `${r.reason_type} ${r.n}`).join(", ") || "none"}`);
const run = await (await fetch(`${APP_URL}/api/run`)).json();
console.log(`Run state: ${run.status}   Inbox files: ${JSON.stringify(run.files)}`);

const slow = summary.filter((s) => s.seconds > MAX_DURATION_S / 2);
if (slow.length) {
  console.log(`\n!! Over half of maxDuration (${MAX_DURATION_S / 2} s): ${slow.map((s) => `${s.file} ${s.seconds} s`).join("; ")}`);
}
const failed = summary.filter((s) => s.result === "ERROR");
if (failed.length) {
  console.log(`\n!! ${failed.length} file(s) failed: ${failed.map((s) => s.file).join(", ")}`);
  process.exitCode = 1;
}
const notRun = fileCount - summary.length;
if (notRun > 0) {
  console.log(`\n!! ${notRun} file(s) not run (their queue stopped after a failure).`);
  process.exitCode = 1;
}
