// Rebuilds the database: runs db/schema.sql then db/seed.sql against DATABASE_URL.
// Usage: npm run db:setup   (safe to re-run; it drops and recreates every table)
//
// Uses Pool (WebSocket) from @neondatabase/serverless because a query with no
// parameters goes over Postgres's simple query protocol, which accepts a whole
// file of statements at once. Everything runs in one transaction.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "@neondatabase/serverless";

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

const pool = new Pool({ connectionString: url });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  console.log("Running db/schema.sql…");
  await client.query(schema);
  console.log("Running db/seed.sql…");
  await client.query(seed);
  await client.query("COMMIT");

  const { rows } = await client.query(`
    SELECT 'suppliers' AS table_name, count(*)::int AS rows FROM suppliers
    UNION ALL SELECT 'rules', count(*)::int FROM rules
    UNION ALL SELECT 'source_files', count(*)::int FROM source_files
    UNION ALL SELECT 'source_files (held back)', count(*)::int FROM source_files WHERE is_held_back
    UNION ALL SELECT 'quote_lines', count(*)::int FROM quote_lines
    UNION ALL SELECT 'quote_lines (history)', count(*)::int FROM quote_lines WHERE is_history
    UNION ALL SELECT 'review_items', count(*)::int FROM review_items
    UNION ALL SELECT 'agent_events', count(*)::int FROM agent_events
    UNION ALL SELECT 'price_lists', count(*)::int FROM price_lists
  `);
  console.table(rows);
  console.log("Database ready.");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Database setup failed:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
