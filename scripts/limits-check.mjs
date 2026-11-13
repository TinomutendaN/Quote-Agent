// Checks Reset demo and the daily limits against the running dev server, with
// NO agent runs and NO model calls (cost $0). Every request that could reach
// the model is only sent once the script has made sure it will be refused.
//
//   DAILY_MAX_RUNS=2 DAILY_MAX_UPLOADS=2 DAILY_MAX_QUESTIONS=2 npm run dev   (another terminal)
//   npm run limits:check
//
// Covers: reset basics, the reset cooldown, the run lock against reset (run,
// file 16, upload), the run limit (takeovers not counted), the saved-run
// fallback, the upload and question limits (atomic counting), and that
// npm run db:setup keeps daily_usage and demo_meta.
//
// It changes the shared database: it deletes today's daily_usage row between
// sections and ends with a fresh reset (today's counts back at zero).
// Options (environment): APP_URL (default http://localhost:3000).
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
// The limits the dev server was started with (this script's test values).
const LIMIT = 2;

const db = await import("../lib/db.ts");
const sql = neon(process.env.DATABASE_URL.trim());
const q = (text, params = []) => sql.query(text, params);
const one = async (text, params) => (await q(text, params))[0];

const TODAY = "(now() AT TIME ZONE 'Europe/London')::date";
const MSG = {
  runs: "The demo has reached today's limit for new runs – it resets at midnight UK time.",
  uploads: "The demo has reached today's limit for added quotes – it resets at midnight UK time.",
  questions: "The demo has reached today's limit for questions – it resets at midnight UK time.",
  busy: "Someone is running the demo right now – try again in a few minutes.",
  cooldown: "The demo was just reset – try again in a minute.",
};

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
}
function section(title) {
  console.log(`\n— ${title}`);
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}
const postJson = (path, value) =>
  post(path, value === undefined ? undefined : JSON.stringify(value), { "Content-Type": "application/json" });

/** Test-only: forget today's usage. */
const clearUsage = () => q(`DELETE FROM daily_usage WHERE day = ${TODAY}`);
const usage = async () =>
  (await one(`SELECT runs, uploads, questions FROM daily_usage WHERE day = ${TODAY}`)) ?? {
    runs: 0,
    uploads: 0,
    questions: 0,
  };
/** Test-only: move the last reset back so the next reset isn't refused by the cooldown. */
const skipCooldown = () => q(`UPDATE demo_meta SET last_reset_at = now() - interval '2 minutes'`);
const lastReset = async () => (await one(`SELECT last_reset_at::text AS t FROM demo_meta WHERE id = 1`))?.t ?? null;
const runRow = () => one(`SELECT status, saved_run FROM demo_run WHERE id = 1`);
const stallRun = () => q(`UPDATE demo_run SET last_activity_at = now() - interval '11 minutes'`);

async function reset() {
  await skipCooldown();
  return postJson("/api/reset");
}

async function page(path) {
  const res = await fetch(`${APP_URL}${path}`);
  return res.text();
}

// ---------------------------------------------------------------------------
try {
  await fetch(`${APP_URL}/api/run`);
} catch {
  console.error(`The dev server isn't running at ${APP_URL}. Start it with:
  DAILY_MAX_RUNS=2 DAILY_MAX_UPLOADS=2 DAILY_MAX_QUESTIONS=2 npm run dev`);
  process.exit(1);
}

section("Reset basics");
await clearUsage();
{
  const r = await reset();
  check("reset → fresh", r.status === 200 && r.json?.mode === "fresh", r.text);
  const counts = await one(`SELECT
      (SELECT count(*)::int FROM source_files) AS files,
      (SELECT count(*)::int FROM quote_lines WHERE is_history) AS history,
      (SELECT count(*)::int FROM quote_lines WHERE NOT is_history) AS lines,
      (SELECT count(*)::int FROM price_lists) AS lists`);
  check("18 files, 21 past prices, no new lines, v1 + v2", counts.files === 18 && counts.history === 21 && counts.lines === 0 && counts.lists === 2, JSON.stringify(counts));
  const run = await runRow();
  check("run idle, not the saved run", run.status === "idle" && run.saved_run === false, JSON.stringify(run));
  const inbox = await page("/inbox");
  check("Inbox has no saved-run note", !inbox.includes("Showing a real earlier run"));
}

section("Reset cooldown");
{
  const before = await lastReset();
  const r = await postJson("/api/reset");
  check("second reset within a minute → 429", r.status === 429 && r.json?.error === MSG.cooldown, r.text);
  check("refused reset leaves last_reset_at alone", (await lastReset()) === before);
}

section("npm run db:setup keeps daily_usage and demo_meta");
{
  await q(`INSERT INTO daily_usage (day, runs) VALUES ('2000-01-01', 7) ON CONFLICT (day) DO UPDATE SET runs = 7`);
  const before = await lastReset();
  execSync("npm run db:setup", { cwd: root, stdio: "ignore" });
  const kept = await one(`SELECT runs FROM daily_usage WHERE day = '2000-01-01'`);
  check("db:setup works straight after a reset (no cooldown)", true);
  check("daily_usage row survives db:setup", kept?.runs === 7, JSON.stringify(kept));
  check("demo_meta survives db:setup", (await lastReset()) === before);
  await q(`DELETE FROM daily_usage WHERE day = '2000-01-01'`);
}

section("Run lock against reset");
await clearUsage();
{
  const start = await postJson("/api/run");
  check("Process inbox claims the run (no agent call)", start.json?.started === true, start.text);
  await skipCooldown();
  const before = await lastReset();
  const r = await postJson("/api/reset");
  check("reset during a run → 409", r.status === 409 && r.json?.error === MSG.busy, r.text);
  check("run still running", (await runRow()).status === "running");
  check("busy refusal leaves last_reset_at alone", (await lastReset()) === before);
  await stallRun();
  const r2 = await reset();
  check("reset once the run is stalled (11 min) → ok", r2.status === 200 && r2.json?.mode === "fresh", r2.text);

  await q(`UPDATE demo_run SET status = 'finished', last_activity_at = now()`);
  await q(`UPDATE source_files SET status = 'working' WHERE is_held_back`);
  const r3 = await reset();
  check("reset while file 16 is being read → 409", r3.status === 409, r3.text);
  await stallRun();
  const r4 = await reset();
  check("reset once file 16 is stalled → ok", r4.status === 200, r4.text);

  await q(`INSERT INTO source_files (file_name, type, received_at, is_upload, status)
           VALUES ('test-upload.txt', 'email', now(), true, 'working')`);
  const r5 = await reset();
  check("reset while an upload is being read → 409", r5.status === 409, r5.text);
  await q(`UPDATE source_files SET received_at = now() - interval '11 minutes' WHERE is_upload`);
  const r6 = await reset();
  check("reset once the upload is stalled → ok", r6.status === 200, r6.text);
}

section(`Run limit (${LIMIT} a day)`);
await clearUsage();
{
  const a = await postJson("/api/run");
  check("1st run starts", a.json?.started === true && (await usage()).runs === 1, a.text);
  await stallRun();
  const t = await postJson("/api/run");
  check("taking over a stalled run isn't counted", t.json?.took_over === true && (await usage()).runs === 1, t.text);
  await stallRun();
  check("reset (runs 1 of 2) → fresh", (await reset()).json?.mode === "fresh");
  const b = await postJson("/api/run");
  check("2nd run starts", b.json?.started === true && (await usage()).runs === 2, b.text);
  await q(`UPDATE demo_run SET status = 'idle', run_id = NULL, last_activity_at = NULL`);
  const c = await postJson("/api/run");
  check("3rd start → limit message", c.json?.started === false && c.json?.limit_reached === true && c.json?.message === MSG.runs, c.text);
  check("refused start isn't counted", (await usage()).runs === 2);
}

section("Saved-run fallback");
{
  const r = await reset();
  check("reset at the run limit → processed", r.status === 200 && r.json?.mode === "processed", r.text);
  const counts = await one(`SELECT
      (SELECT count(*)::int FROM quote_lines WHERE NOT is_history) AS lines,
      (SELECT count(*)::int FROM review_items WHERE status = 'open') AS open_items,
      (SELECT count(*)::int FROM quote_lines q JOIN source_files f ON f.id = q.source_file_id
         WHERE f.is_held_back AND q.status = 'pending') AS new_quote_pending`);
  check("137 lines, 4 open review items, file 16 pending", counts.lines === 137 && counts.open_items === 4 && counts.new_quote_pending === 1, JSON.stringify(counts));
  const run = await runRow();
  check("run finished and marked as the saved run", run.status === "finished" && run.saved_run === true, JSON.stringify(run));
  const start = await postJson("/api/run");
  check("Process inbox → shows the saved results", start.json?.started === false && /already been processed/.test(start.json?.message ?? ""), start.text);
  const [inbox, agent] = await Promise.all([page("/inbox"), page("/agent")]);
  check("Inbox shows the saved-run note", inbox.includes("Showing a real earlier run") && inbox.includes("limit for new runs has been reached"));
  check("Agent run shows the saved-run note", agent.includes("Showing a real earlier run"));
}

section(`Upload limit (${LIMIT} a day, 10 per reset)`);
await clearUsage();
{
  check("reset (limit cleared) → fresh", (await reset()).json?.mode === "fresh");
  const file = { fileName: "limits-check.txt", type: "email" };
  const five = await Promise.all(Array.from({ length: 5 }, () => db.insertUpload(file, LIMIT)));
  const ok = five.filter((x) => "id" in x).length;
  check(`5 at once with a daily limit of ${LIMIT} → exactly ${LIMIT} added`, ok === LIMIT && (await usage()).uploads === LIMIT, JSON.stringify(five));
  check("the others are told it's the daily limit", five.filter((x) => x.limit === "daily").length === 5 - LIMIT);
  const twelve = await Promise.all(Array.from({ length: 12 }, () => db.insertUpload(file, 100)));
  const total = (await one(`SELECT count(*)::int AS n FROM source_files WHERE is_upload`)).n;
  check("12 more at once → stops at 10 per reset", total === 10 && twelve.filter((x) => x.limit === "reset").length === 4, `total ${total}`);
  check("refused uploads don't use a daily slot", (await usage()).uploads === 10);
  await q(`DELETE FROM source_files WHERE is_upload`);

  // Only sent once today's count is at the server's limit, so it's refused before the model.
  if ((await usage()).uploads >= LIMIT) {
    const form = new FormData();
    form.append("file", new Blob(["From: test\nSubject: test\n\nLeeds to York £100"], { type: "text/plain" }), "limits-check.txt");
    const res = await fetch(`${APP_URL}/api/upload`, { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    check("Add quotes at the daily limit → 429 with the message", res.status === 429 && body?.error === MSG.uploads, JSON.stringify(body));
  }
  check("no upload rows left", (await one(`SELECT count(*)::int AS n FROM source_files WHERE is_upload`)).n === 0);
}

section(`Question limit (${LIMIT} a day)`);
await clearUsage();
{
  await q(`INSERT INTO daily_usage (day, questions) VALUES (${TODAY}, $1)`, [LIMIT]);
  if ((await usage()).questions >= LIMIT) {
    const r = await postJson("/api/ask", {
      messages: [{ id: "q1", role: "user", parts: [{ type: "text", text: "What changed since v2?" }] }],
    });
    check("Ask at the daily limit → 429 with the message", r.status === 429 && r.json?.error === MSG.questions, r.text);
    check("refused question isn't counted", (await usage()).questions === LIMIT);
  }
  await clearUsage();
  const ten = await Promise.all(Array.from({ length: 10 }, () => db.takeQuestionAllowance(3)));
  check("10 at once with a limit of 3 → exactly 3 counted", ten.filter(Boolean).length === 3 && (await usage()).questions === 3);
}

section("Finish");
await clearUsage();
{
  const r = await reset();
  check("back to a fresh inbox", r.json?.mode === "fresh" && (await runRow()).status === "idle", r.text);
}

console.log(`\n${passed} passed, ${failed} failed. Model calls: 0 (cost $0).`);
process.exitCode = failed ? 1 : 0;
