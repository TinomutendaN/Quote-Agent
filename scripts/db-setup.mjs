// Rebuilds the database: runs db/schema.sql then db/seed.sql against DATABASE_URL.
// Usage: npm run db:setup       (safe to re-run; it drops and recreates every table)
//        npm run db:processed   (same, then db/fixture-processed.sql: the database
//                                looks exactly as if the agent had just finished,
//                                with no model calls – for testing later steps)
//
// Shares resetDatabase() in lib/db.ts with Reset demo (one transaction), but
// skips Reset's checks (cooldown, someone using the agent) and never marks
// the result as the saved earlier run. daily_usage and demo_meta are kept.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "@neondatabase/serverless";
import { resetDatabase } from "../lib/db.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const envFile = join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is missing. Add it to .env.local.");
  process.exit(1);
}

const processed = process.argv.includes("--processed");
if (processed && !existsSync(join(root, "db", "fixture-processed.sql"))) {
  console.error("db/fixture-processed.sql is missing. Make it with npm run db:export-processed.");
  process.exit(1);
}

try {
  console.log(
    processed
      ? "Running db/schema.sql, db/seed.sql and db/fixture-processed.sql…"
      : "Running db/schema.sql and db/seed.sql…",
  );
  const result = await resetDatabase({ mode: processed ? "processed" : "fresh", checks: null, root });
  if (processed && result.ok) console.log(`Approved ${result.approved} lines the agent never flagged.`);
} catch (err) {
  console.error("Database setup failed:", err.message);
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const client = await pool.connect();

try {
  const { rows } = await client.query(`
    SELECT 'suppliers' AS table_name, count(*)::int AS rows FROM suppliers
    UNION ALL SELECT 'rules', count(*)::int FROM rules
    UNION ALL SELECT 'source_files', count(*)::int FROM source_files
    UNION ALL SELECT 'source_files (held back)', count(*)::int FROM source_files WHERE is_held_back
    UNION ALL SELECT 'quote_lines', count(*)::int FROM quote_lines
    UNION ALL SELECT 'quote_lines (history)', count(*)::int FROM quote_lines WHERE is_history
    UNION ALL SELECT 'quote_lines (held back, pending)', count(*)::int FROM quote_lines q
                JOIN source_files f ON f.id = q.source_file_id WHERE f.is_held_back AND q.status = 'pending'
    UNION ALL SELECT 'review_items', count(*)::int FROM review_items
    UNION ALL SELECT 'agent_events', count(*)::int FROM agent_events
    UNION ALL SELECT 'price_lists', count(*)::int FROM price_lists
    UNION ALL SELECT 'demo_run (' || status || ')', 1 FROM demo_run
  `);
  console.table(rows);
  console.log(processed ? "Database ready, as if the agent had just finished." : "Database ready.");
} catch (err) {
  console.error("Couldn't read the table counts:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
