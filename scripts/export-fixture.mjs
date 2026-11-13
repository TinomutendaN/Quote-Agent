// Saves the current database's agent results as db/fixture-processed.sql, so
// later steps can be tested without calling the model (npm run db:processed).
//
//   npm run db:setup && npm run dev            (fresh reset, server running)
//   npm run agent:test -- all && npm run agent:test -- 16
//   (check the results against public/samples/README.md)
//   npm run db:export-processed
//
// Exports, as statements that apply on top of db/seed.sql: source_files
// statuses, quote_lines (not past prices), review_items, agent_events and the
// demo_run row. Refuses if there are uploads or the run isn't finished, so the
// fixture is always a clean "agent just finished" state. Regenerate it from a
// fresh full run whenever agent-related code changes.
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const sql = neon(process.env.DATABASE_URL);

/** A SQL literal: NULL, a number, or a quoted string with ' doubled. */
function lit(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const [run] = await sql`
  SELECT status, started_at::text AS started_at, last_activity_at::text AS last_activity_at,
         finished_at::text AS finished_at
  FROM demo_run WHERE id = 1`;
const [{ uploads, unfinished }] = await sql`
  SELECT count(*) FILTER (WHERE is_upload)::int AS uploads,
         count(*) FILTER (WHERE NOT is_upload AND status NOT IN ('done', 'needs_review'))::int AS unfinished
  FROM source_files`;
if (run.status !== "finished" || unfinished > 0 || uploads > 0) {
  console.error(
    `Not exporting: run is ${run.status}, ${unfinished} file(s) not finished (file 16 included), ${uploads} upload(s).`,
  );
  console.error("Export only a fresh, finished full run (inbox plus file 16) with no uploads.");
  process.exit(1);
}

const files = await sql`SELECT id, file_name, status FROM source_files ORDER BY id`;
const lines = await sql`
  SELECT id, source_file_id, supplier_id, route, category, rule_number, price::text AS price,
         unit_note, vat_note, time_slot, goods, quote_date::text AS quote_date, status,
         created_at::text AS created_at
  FROM quote_lines WHERE NOT is_history ORDER BY id`;
const reviews = await sql`
  SELECT id, quote_line_id, source_file_id, reason_type, reason_text, original_excerpt,
         usual_price::text AS usual_price, suggestion, status, resolved_at::text AS resolved_at,
         created_at::text AS created_at
  FROM review_items ORDER BY id`;
const events = await sql`
  SELECT id, source_file_id, step_number, tool_name, text, duration_ms, created_at::text AS created_at
  FROM agent_events ORDER BY id`;

const out = [];
out.push(
  "-- Agent results from a full run of the sample inbox plus file 16, saved by",
  "-- scripts/export-fixture.mjs. Applies on top of db/seed.sql (npm run db:processed)",
  "-- so later steps can be tested without calling the model. Do not edit by hand:",
  "-- regenerate it from a fresh full run whenever agent-related code changes.",
  `-- Exported ${new Date().toISOString()}: ${lines.length} lines, ${reviews.length} review items, ${events.length} events.`,
  "",
  "-- File statuses",
);
for (const f of files) {
  out.push(`UPDATE source_files SET status = ${lit(f.status)} WHERE id = ${lit(f.id)} AND file_name = ${lit(f.file_name)};`);
}

out.push("", "-- Saved prices (past prices come from seed.sql)");
for (const l of lines) {
  out.push(
    "INSERT INTO quote_lines (id, source_file_id, supplier_id, route, category, rule_number, price, unit_note, vat_note, time_slot, goods, quote_date, status, is_history, created_at) VALUES (" +
      [
        lit(l.id), lit(l.source_file_id), lit(l.supplier_id), lit(l.route), lit(l.category), lit(l.rule_number),
        lit(l.price), lit(l.unit_note), lit(l.vat_note), lit(l.time_slot), lit(l.goods), lit(l.quote_date),
        lit(l.status), "false", lit(l.created_at),
      ].join(", ") +
      ");",
  );
}

out.push("", "-- Review items");
for (const r of reviews) {
  out.push(
    "INSERT INTO review_items (id, quote_line_id, source_file_id, reason_type, reason_text, original_excerpt, usual_price, suggestion, status, resolved_at, created_at) VALUES (" +
      [
        lit(r.id), lit(r.quote_line_id), lit(r.source_file_id), lit(r.reason_type), lit(r.reason_text),
        lit(r.original_excerpt), lit(r.usual_price), lit(r.suggestion), lit(r.status), lit(r.resolved_at),
        lit(r.created_at),
      ].join(", ") +
      ");",
  );
}

out.push("", "-- Agent events");
for (const e of events) {
  out.push(
    "INSERT INTO agent_events (id, source_file_id, step_number, tool_name, text, duration_ms, created_at) VALUES (" +
      [lit(e.id), lit(e.source_file_id), lit(e.step_number), lit(e.tool_name), lit(e.text), lit(e.duration_ms), lit(e.created_at)].join(", ") +
      ");",
  );
}

out.push(
  "",
  "-- Keep the id sequences ahead of the rows above",
  "SELECT setval(pg_get_serial_sequence('quote_lines', 'id'), (SELECT max(id) FROM quote_lines));",
  "SELECT setval(pg_get_serial_sequence('review_items', 'id'), GREATEST((SELECT max(id) FROM review_items), 1), (SELECT count(*) > 0 FROM review_items));",
  "SELECT setval(pg_get_serial_sequence('agent_events', 'id'), GREATEST((SELECT max(id) FROM agent_events), 1), (SELECT count(*) > 0 FROM agent_events));",
  "",
  "-- The run: finished, owned by nobody",
  `UPDATE demo_run SET status = 'finished', run_id = NULL, started_at = ${lit(run.started_at)}, last_activity_at = ${lit(run.last_activity_at)}, finished_at = ${lit(run.finished_at)} WHERE id = 1;`,
  "",
);

const target = join(root, "db", "fixture-processed.sql");
writeFileSync(target, out.join("\n"));
console.log(
  `Saved db/fixture-processed.sql: ${files.length} file statuses, ${lines.length} lines, ${reviews.length} review items, ${events.length} events.`,
);
