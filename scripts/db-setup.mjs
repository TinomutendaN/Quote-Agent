// Rebuilds the database: runs db/schema.sql then db/seed.sql against DATABASE_URL.
// Usage: npm run db:setup       (safe to re-run; it drops and recreates every table)
//        npm run db:processed   (same, then db/fixture-processed.sql: the database
//                                looks exactly as if the agent had just finished,
//                                with no model calls – for testing later steps)
//
// Uses Pool (WebSocket) from @neondatabase/serverless because a query with no
// parameters goes over Postgres's simple query protocol, which accepts a whole
// file of statements at once. Everything runs in one transaction.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "@neondatabase/serverless";
import { APPROVE_UNFLAGGED_SQL } from "../lib/db.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const envFile = join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is missing. Add it to .env.local.");
  process.exit(1);
}

const schema = readFileSync(join(root, "db", "schema.sql"), "utf8");
const seed = readFileSync(join(root, "db", "seed.sql"), "utf8");
const processed = process.argv.includes("--processed");
const fixturePath = join(root, "db", "fixture-processed.sql");
if (processed && !existsSync(fixturePath)) {
  console.error("db/fixture-processed.sql is missing. Make it with npm run db:export-processed.");
  process.exit(1);
}
const fixture = processed ? readFileSync(fixturePath, "utf8") : null;

const pool = new Pool({ connectionString: url });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  console.log("Running db/schema.sql…");
  await client.query(schema);
  console.log("Running db/seed.sql…");
  await client.query(seed);
  if (fixture) {
    console.log("Running db/fixture-processed.sql…");
    await client.query(fixture);
    // The fixture was saved before lines were approved on finish (Step 7):
    // approve the never-flagged lines exactly as the app does.
    const approved = await client.query(APPROVE_UNFLAGGED_SQL, [null]);
    console.log(`Approved ${approved.rowCount} lines the agent never flagged.`);
  }
  await client.query("COMMIT");

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
  await client.query("ROLLBACK").catch(() => {});
  console.error("Database setup failed:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
