// Database client and every SQL query (fixed and parameterised).
// The model never writes SQL: agent and Ask tools call functions in this file.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Markup, PriceLine, PriceRow } from "./pricing";

let client: NeonQueryFunction<false, false> | null = null;

function db(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error("DATABASE_URL is missing. Set it in .env.local (or in Vercel).");
    }
    client = neon(url);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceFileType = "email" | "pdf" | "scan" | "spreadsheet";
export type SourceFileStatus = "waiting" | "working" | "done" | "needs_review";
export type Category = "Standard" | "Out-of-hours" | "Specialist";

export type Supplier = {
  id: number;
  name: string;
  initials: string;
  colour: string;
};

export type Rule = {
  id: number;
  number: number;
  text: string;
};

export type SourceFile = {
  id: number;
  supplier_id: number | null;
  supplier_name: string | null;
  sender_name: string | null;
  file_name: string;
  file_path: string;
  type: SourceFileType;
  received_at: string;
  /** UK time, e.g. "08:12". */
  received_time: string;
  /** UK date, e.g. "Wed 11 Nov". */
  received_day: string;
  is_held_back: boolean;
  is_upload: boolean;
  status: SourceFileStatus;
};

/** One row of a saved price list (same shape for every version, see lib/pricing.ts). */
export type PriceListRow = PriceRow;

export type PriceList = {
  id: number;
  version: number;
  label: string;
  status: "draft" | "saved";
  markup: Markup;
  rows: PriceListRow[];
  created_at: string;
  /** UK time, e.g. "13 Nov 2026, 14:05" */
  created_label: string;
};

// ---------------------------------------------------------------------------
// Read queries
// ---------------------------------------------------------------------------

export async function listSuppliers(): Promise<Supplier[]> {
  return (await db()`
    SELECT id, name, initials, colour
    FROM suppliers
    ORDER BY name
  `) as Supplier[];
}

export async function listRules(): Promise<Rule[]> {
  return (await db()`
    SELECT id, number, text
    FROM rules
    ORDER BY number
  `) as Rule[];
}

export type SourceFileWithCount = SourceFile & {
  /** Prices saved from this file (never past prices). */
  lines_found: number;
  /** Review items on this file still waiting for a person. */
  open_reviews: number;
};

/** All source files with their supplier name and saved-price count, oldest first. */
export async function listSourceFiles(): Promise<SourceFileWithCount[]> {
  return (await db()`
    SELECT f.id, f.supplier_id, s.name AS supplier_name, f.sender_name,
           f.file_name, f.file_path, f.type, f.received_at::text AS received_at,
           to_char(f.received_at AT TIME ZONE 'Europe/London', 'HH24:MI') AS received_time,
           to_char(f.received_at AT TIME ZONE 'Europe/London', 'Dy FMDD Mon') AS received_day,
           f.is_held_back, f.is_upload, f.status,
           (SELECT count(*)::int FROM quote_lines q
             WHERE q.source_file_id = f.id AND NOT q.is_history) AS lines_found
    FROM source_files f
    LEFT JOIN suppliers s ON s.id = f.supplier_id
    ORDER BY f.received_at, f.id
  `) as SourceFileWithCount[];
}

export type HistoryLine = {
  id: number;
  supplier_id: number;
  route: string;
  category: Category;
  price: string; // numeric comes back as text, e.g. "158.00"
  /** e.g. "2 Oct 2026" */
  quote_day: string;
};

/** Seeded past prices (is_history = true) for every supplier, by route and date. */
export async function listHistoryLines(): Promise<HistoryLine[]> {
  return (await db()`
    SELECT id, supplier_id, route, category, price::text AS price,
           to_char(quote_date, 'FMDD Mon YYYY') AS quote_day
    FROM quote_lines
    WHERE is_history AND supplier_id IS NOT NULL
    ORDER BY route, category, quote_date, id
  `) as HistoryLine[];
}

/** Review items still waiting for a person (for the sidebar badge). */
export async function countOpenReviewItems(): Promise<number> {
  const rows = await db()`
    SELECT count(*)::int AS count FROM review_items WHERE status = 'open'
  `;
  return rows[0].count as number;
}

/** Number of seeded past-price lines (is_history = true). */
export async function countHistoryLines(): Promise<number> {
  const rows = await db()`
    SELECT count(*)::int AS count FROM quote_lines WHERE is_history
  `;
  return rows[0].count as number;
}

/** All price lists, newest version first. */
export async function listPriceLists(): Promise<PriceList[]> {
  return (await db()`
    SELECT id, version, label, status, markup, rows, created_at::text AS created_at,
           to_char(created_at AT TIME ZONE 'Europe/London', 'FMDD Mon YYYY, HH24:MI') AS created_label
    FROM price_lists
    ORDER BY version DESC
  `) as PriceList[];
}

// ---------------------------------------------------------------------------
// Price lists (Step 8). The maths lives in lib/pricing.ts.
// ---------------------------------------------------------------------------

/**
 * Every approved quote line that can go into a new price list: never past
 * prices, never rejected or pending lines (so the held-back file 16 waits for
 * v4), and only lines with a supplier and a service.
 */
export async function listCurrentPriceLines(): Promise<PriceLine[]> {
  return (await db()`
    SELECT q.id, q.route, q.category, q.time_slot, q.goods, q.unit_note,
           s.name AS supplier, q.price::text AS price, q.quote_date::text AS quote_date
    FROM quote_lines q
    JOIN suppliers s ON s.id = q.supplier_id
    WHERE NOT q.is_history AND q.status = 'approved' AND q.category IS NOT NULL
    ORDER BY q.id
  `) as PriceLine[];
}

/**
 * Lines still waiting (pending) from finished inbox files and uploads, never
 * the held-back file. The screen counts the jobs among them that aren't in
 * the list yet, for "X/Y Routes approved".
 */
export async function listWaitingPriceLines(): Promise<PriceLine[]> {
  return (await db()`
    SELECT q.id, q.route, q.category, q.time_slot, q.goods, q.unit_note,
           coalesce(s.name, '') AS supplier, q.price::text AS price, q.quote_date::text AS quote_date
    FROM quote_lines q
    JOIN source_files f ON f.id = q.source_file_id
    LEFT JOIN suppliers s ON s.id = q.supplier_id
    WHERE NOT q.is_history AND q.status = 'pending' AND q.category IS NOT NULL
      AND NOT f.is_held_back AND f.status IN ('done', 'needs_review')
    ORDER BY q.id
  `) as PriceLine[];
}

/**
 * Saves a new version, only if it is exactly one above the latest saved
 * version (so two visitors can't both save the same number). Returns false
 * when someone else saved first.
 */
export async function savePriceList(list: {
  version: number;
  label: string;
  markup: Markup;
  rows: PriceRow[];
}): Promise<boolean> {
  const rows = await db().query(
    `INSERT INTO price_lists (version, label, status, markup, rows)
     SELECT $1::int, $2::text, 'saved', $3::jsonb, $4::jsonb
     WHERE (SELECT coalesce(max(version), 0) FROM price_lists WHERE status = 'saved') = $1::int - 1
     ON CONFLICT (version) DO NOTHING
     RETURNING id`,
    [list.version, list.label, JSON.stringify(list.markup), JSON.stringify(list.rows)],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Agent queries (Step 5). Each agent tool calls exactly one of these.
// ---------------------------------------------------------------------------

export type TimeSlot = "weekday" | "evening" | "overnight" | "weekend";
export type Goods = "general" | "chilled_medical" | "fragile" | "secure";
export type ReasonType = "price_wrong" | "duplicate" | "unclear" | "unknown_sender";

export type QuoteLine = {
  id: number;
  source_file_id: number | null;
  supplier_id: number | null;
  route: string;
  category: Category | null;
  rule_number: number | null;
  price: string;
  unit_note: string | null;
  vat_note: string | null;
  time_slot: TimeSlot | null;
  goods: Goods | null;
  status: "pending" | "approved" | "rejected";
};

// Every route is reduced to the same text before matching, in SQL and in TS:
// lower case, each separator (→, ->, >, " - ", " – ", " — ", " to ") turned
// into " → ", spaces collapsed. "Leeds - Bristol" and "leeds to bristol" both
// become "leeds → bristol".
const ROUTE_SEPARATOR = /\s*(?:→|->|>|\s[-–—]\s|\sto\s)\s*/gi;

// Routes hold places only. Days, times and goods belong in time_slot and
// goods, so any that slip into the route text are removed here.
const QUALIFIER_WORDS =
  "saturdays?|sundays?|weekends?|weekdays?|evenings?|nights?|overnight|out[ -]of[ -]hours|ooh|std|" +
  "same[ -]day|next[ -]day|mon(?:day)?\\s*[-–]\\s*fri(?:day)?|after\\s+\\d{1,2}(?::\\d{2})?\\s*(?:pm)?|" +
  "\\d{1,2}(?::\\d{2})?\\s*[-–]\\s*\\d{1,2}(?::\\d{2})?|chilled|fragile|medical|secure|" +
  "temperature[ -]controlled|pharmacy";
// "(Saturday)", "[evening]", "(chilled, 2–8°C)": any bracket holding one of the words.
const BRACKET_QUALIFIER = new RegExp(
  `\\s*[(\\[][^)\\]]*\\b(?:${QUALIFIER_WORDS}|sat|sun)\\b[^)\\]]*[)\\]]`,
  "gi",
);
// "London → Manchester, Saturday" or "London → Manchester – evening" at the end.
const TRAILING_QUALIFIER = new RegExp(`(?:\\s*[,;:–—-]\\s*|\\s+)(?:${QUALIFIER_WORDS})\\s*$`, "i");

/** Tidies a route to "Origin → Destination" with places only (keeps the model's capitals). */
export function tidyRoute(route: string): string {
  let text = route.replace(BRACKET_QUALIFIER, "");
  for (let i = 0; i < 3 && TRAILING_QUALIFIER.test(text); i++) {
    text = text.replace(TRAILING_QUALIFIER, "");
  }
  return text.replace(ROUTE_SEPARATOR, " → ").replace(/\s+/g, " ").trim();
}

function routeKey(route: string): string {
  return tidyRoute(route).toLowerCase();
}

/** One source file with its supplier name, or null if it doesn't exist. */
export async function getSourceFile(id: number): Promise<SourceFile | null> {
  const rows = (await db()`
    SELECT f.id, f.supplier_id, s.name AS supplier_name, f.sender_name,
           f.file_name, f.file_path, f.type, f.received_at::text AS received_at,
           to_char(f.received_at AT TIME ZONE 'Europe/London', 'HH24:MI') AS received_time,
           to_char(f.received_at AT TIME ZONE 'Europe/London', 'Dy FMDD Mon') AS received_day,
           f.is_held_back, f.is_upload, f.status
    FROM source_files f
    LEFT JOIN suppliers s ON s.id = f.supplier_id
    WHERE f.id = ${id}
  `) as SourceFile[];
  return rows[0] ?? null;
}

export async function setSourceFileStatus(id: number, status: SourceFileStatus): Promise<void> {
  await db()`UPDATE source_files SET status = ${status} WHERE id = ${id}`;
}

/**
 * Removes a run's saved lines and review items for one file (and its events
 * unless keepEvents), so it can be processed again or a failed run leaves
 * no half-finished data.
 */
export async function clearFileResults(
  fileId: number,
  { keepEvents = false }: { keepEvents?: boolean } = {},
): Promise<void> {
  await db().transaction((sql) => [
    sql`DELETE FROM review_items
        WHERE source_file_id = ${fileId}
           OR quote_line_id IN (SELECT id FROM quote_lines WHERE source_file_id = ${fileId})`,
    sql`DELETE FROM quote_lines WHERE source_file_id = ${fileId} AND NOT is_history`,
    ...(keepEvents ? [] : [sql`DELETE FROM agent_events WHERE source_file_id = ${fileId}`]),
  ]);
}

const LINE_COLUMNS = `id, source_file_id, supplier_id, route, category, rule_number,
  price::text AS price, unit_note, vat_note, time_slot, goods, status`;

/** save_quote_line */
export async function insertQuoteLine(line: {
  sourceFileId: number;
  supplierId: number | null;
  route: string;
  price: number;
  unitNote: string;
  vatNote: string;
  timeSlot: TimeSlot;
  goods: Goods;
  quoteDate: string | null;
}): Promise<QuoteLine> {
  const rows = (await db().query(
    `INSERT INTO quote_lines (source_file_id, supplier_id, route, price, unit_note, vat_note,
                              time_slot, goods, quote_date, status, is_history)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', false)
     RETURNING ${LINE_COLUMNS}`,
    [
      line.sourceFileId, line.supplierId, tidyRoute(line.route), line.price, line.unitNote,
      line.vatNote, line.timeSlot, line.goods, line.quoteDate,
    ],
  )) as QuoteLine[];
  return rows[0];
}

/** A line saved from this file (never a past price), or null. */
export async function getFileQuoteLine(lineId: number, fileId: number): Promise<QuoteLine | null> {
  const rows = (await db().query(
    `SELECT ${LINE_COLUMNS} FROM quote_lines
     WHERE id = $1 AND source_file_id = $2 AND NOT is_history`,
    [lineId, fileId],
  )) as QuoteLine[];
  return rows[0] ?? null;
}

/** apply_rules */
export async function setQuoteLineCategory(
  lineId: number,
  fileId: number,
  category: Category,
  ruleNumber: number,
): Promise<QuoteLine | null> {
  const rows = (await db().query(
    `UPDATE quote_lines SET category = $3, rule_number = $4
     WHERE id = $1 AND source_file_id = $2 AND NOT is_history
     RETURNING ${LINE_COLUMNS}`,
    [lineId, fileId, category, ruleNumber],
  )) as QuoteLine[];
  return rows[0] ?? null;
}

export type PastPrice = { supplier: string; price: string; quote_day: string };

/** compare_history: past prices (is_history only) for a route and category, any spelling. */
export async function pastPricesForRoute(route: string, category: Category): Promise<PastPrice[]> {
  return (await db()`
    SELECT s.name AS supplier, q.price::text AS price,
           to_char(q.quote_date, 'FMDD Mon YYYY') AS quote_day
    FROM quote_lines q
    LEFT JOIN suppliers s ON s.id = q.supplier_id
    WHERE q.is_history
      AND q.category = ${category}
      AND trim(regexp_replace(
            regexp_replace(lower(q.route), '\\s*(→|->|>|\\s[-–—]\\s|\\sto\\s)\\s*', ' → ', 'g'),
            '\\s+', ' ', 'g')) = ${routeKey(route)}
    ORDER BY q.quote_date, q.id
  `) as PastPrice[];
}

export type DuplicateMatch = {
  id: number;
  price: string;
  file_name: string;
  received_at: string;
  /** e.g. "Wed 11 Nov 11:30" */
  received: string;
};

/**
 * check_duplicates: lines from OTHER files in this run (never past prices) with
 * the same supplier, route, category, time slot and goods but a different price.
 */
export async function findDuplicateLines(line: QuoteLine): Promise<DuplicateMatch[]> {
  if (line.supplier_id === null || line.category === null) return [];
  return (await db()`
    SELECT q.id, q.price::text AS price, f.file_name, f.received_at::text AS received_at,
           to_char(f.received_at AT TIME ZONE 'Europe/London', 'Dy FMDD Mon HH24:MI') AS received
    FROM quote_lines q
    JOIN source_files f ON f.id = q.source_file_id
    WHERE NOT q.is_history
      AND q.status <> 'rejected'
      AND q.supplier_id = ${line.supplier_id}
      AND lower(q.route) = ${line.route.toLowerCase()}
      AND q.category = ${line.category}
      AND q.time_slot IS NOT DISTINCT FROM ${line.time_slot}
      AND q.goods IS NOT DISTINCT FROM ${line.goods}
      AND q.price <> ${line.price}::numeric
      AND q.source_file_id <> ${line.source_file_id}
    ORDER BY f.received_at
  `) as DuplicateMatch[];
}

/** Received time of a file, e.g. "Wed 11 Nov 12:10". */
export async function fileReceivedLabel(fileId: number): Promise<string> {
  const rows = await db()`
    SELECT to_char(received_at AT TIME ZONE 'Europe/London', 'Dy FMDD Mon HH24:MI') AS label
    FROM source_files WHERE id = ${fileId}
  `;
  return (rows[0]?.label as string | undefined) ?? "";
}

/**
 * flag_for_review. Returns the new item id, or null if the same line (or the
 * same file, for file-level items) already has an open item for this reason.
 */
export async function insertReviewItem(item: {
  sourceFileId: number;
  quoteLineId: number | null;
  reasonType: ReasonType;
  reasonText: string;
  originalExcerpt: string;
  usualPrice: number | null;
  suggestion: string;
}): Promise<number | null> {
  const rows = await db()`
    INSERT INTO review_items (quote_line_id, source_file_id, reason_type, reason_text,
                              original_excerpt, usual_price, suggestion)
    SELECT ${item.quoteLineId}::int, ${item.sourceFileId}::int, ${item.reasonType}, ${item.reasonText},
           ${item.originalExcerpt}, ${item.usualPrice}::numeric, ${item.suggestion}
    WHERE NOT EXISTS (
      SELECT 1 FROM review_items
      WHERE status = 'open' AND reason_type = ${item.reasonType}
        AND source_file_id = ${item.sourceFileId}
        AND quote_line_id IS NOT DISTINCT FROM ${item.quoteLineId}::int
    )
    RETURNING id
  `;
  return (rows[0]?.id as number | undefined) ?? null;
}

export async function insertAgentEvent(event: {
  sourceFileId: number;
  stepNumber: number;
  toolName: string;
  text: string;
  durationMs: number;
}): Promise<void> {
  await db()`
    INSERT INTO agent_events (source_file_id, step_number, tool_name, text, duration_ms)
    VALUES (${event.sourceFileId}, ${event.stepNumber}, ${event.toolName}, ${event.text},
            ${event.durationMs})
  `;
}

export type ClaimResult = "claimed" | "not_waiting" | "earlier_file_pending";

/**
 * Claims a file for processing: waiting → working in one statement, so no
 * file is ever processed twice. An inbox file is also refused while an
 * earlier-received inbox file from the same supplier is still waiting or
 * working, so a supplier's later quote never overtakes an earlier one (and
 * check_duplicates always sees the earlier price).
 */
export async function claimSourceFile(id: number): Promise<ClaimResult> {
  const rows = await db()`
    UPDATE source_files f SET status = 'working'
    WHERE f.id = ${id} AND f.status = 'waiting'
      AND (f.is_upload OR f.supplier_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM source_files e
        WHERE e.supplier_id = f.supplier_id AND e.id <> f.id
          AND NOT e.is_upload AND NOT e.is_held_back
          AND e.status IN ('waiting', 'working')
          AND (e.received_at, e.id) < (f.received_at, f.id)))
    RETURNING f.id
  `;
  if (rows.length > 0) return "claimed";
  const [file] = await db()`SELECT status FROM source_files WHERE id = ${id}`;
  return file?.status === "waiting" ? "earlier_file_pending" : "not_waiting";
}

// ---------------------------------------------------------------------------
// Shared demo run (one row in demo_run). Only one Process inbox run at a time.
// ---------------------------------------------------------------------------

export type DemoRunStatus = "idle" | "running" | "finished";

export type DemoRun = {
  status: DemoRunStatus;
  started_at: string | null;
  last_activity_at: string | null;
  finished_at: string | null;
  /** Inbox files (not held back, not uploads) by status. */
  files: { waiting: number; working: number; done: number; needs_review: number };
};

export async function getDemoRun(): Promise<DemoRun> {
  const rows = await db()`
    SELECT r.status, r.started_at::text AS started_at,
           r.last_activity_at::text AS last_activity_at, r.finished_at::text AS finished_at,
           (SELECT json_build_object(
              'waiting',      count(*) FILTER (WHERE status = 'waiting'),
              'working',      count(*) FILTER (WHERE status = 'working'),
              'done',         count(*) FILTER (WHERE status = 'done'),
              'needs_review', count(*) FILTER (WHERE status = 'needs_review'))
            FROM source_files WHERE NOT is_held_back AND NOT is_upload) AS files
    FROM demo_run r WHERE r.id = 1
  `;
  return rows[0] as DemoRun;
}

/**
 * Starts the run in one statement: idle → running, or takes over a running
 * run with no activity for `stallMinutes`. Returns the previous status when
 * this call won, or null when a run is already going (or finished).
 */
export async function claimDemoRun(
  runId: string,
  stallMinutes: number,
): Promise<{ previous: "idle" | "running" } | null> {
  const rows = await db()`
    WITH prev AS (SELECT status FROM demo_run WHERE id = 1 FOR UPDATE)
    UPDATE demo_run r
    SET status = 'running',
        run_id = ${runId}::uuid,
        started_at = CASE WHEN prev.status = 'idle' THEN now() ELSE r.started_at END,
        last_activity_at = now(),
        finished_at = NULL
    FROM prev
    WHERE r.id = 1
      AND (prev.status = 'idle'
           OR (prev.status = 'running'
               AND r.last_activity_at < now() - make_interval(mins => ${stallMinutes}::int)))
    RETURNING prev.status AS previous
  `;
  return (rows[0] as { previous: "idle" | "running" } | undefined) ?? null;
}

/**
 * After a stalled run is taken over: files left as working go back to
 * waiting and their partial lines and review items are removed (events kept).
 * Returns the ids reset.
 */
export async function resetStuckFiles(): Promise<number[]> {
  const results = await db().transaction((sql) => [
    sql`DELETE FROM review_items
        WHERE source_file_id IN (SELECT id FROM source_files WHERE status = 'working' AND NOT is_upload)
           OR quote_line_id IN (SELECT q.id FROM quote_lines q JOIN source_files f ON f.id = q.source_file_id
                                WHERE f.status = 'working' AND NOT f.is_upload)`,
    sql`DELETE FROM quote_lines
        WHERE NOT is_history
          AND source_file_id IN (SELECT id FROM source_files WHERE status = 'working' AND NOT is_upload)`,
    sql`UPDATE source_files SET status = 'waiting'
        WHERE status = 'working' AND NOT is_upload
        RETURNING id`,
  ]);
  return (results[2] as { id: number }[]).map((r) => r.id);
}

/** The run's status if `runId` owns it, else null. */
export async function demoRunStatusFor(runId: string): Promise<DemoRunStatus | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const rows = await db()`
    SELECT status FROM demo_run WHERE id = 1 AND run_id = ${runId}::uuid
  `;
  return (rows[0]?.status as DemoRunStatus | undefined) ?? null;
}

/**
 * Marks the owner's run as active now (keeps it from counting as stalled).
 * Also after the run has finished, while file 16 is being processed.
 */
export async function touchDemoRun(runId: string): Promise<void> {
  await db()`
    UPDATE demo_run SET last_activity_at = now()
    WHERE id = 1 AND run_id = ${runId}::uuid AND status IN ('running', 'finished')
  `;
}

/**
 * Finished run, file 16 left stuck as working (its request was cut off) and
 * no activity for `stallMinutes`: put it back to waiting and drop its
 * partial lines and review items (events kept).
 */
export async function resetStalledHeldBack(stallMinutes: number): Promise<void> {
  await db().transaction((tx) => [
    tx`DELETE FROM review_items
       WHERE source_file_id IN (
         SELECT f.id FROM source_files f, demo_run r
         WHERE r.id = 1 AND r.status = 'finished' AND f.is_held_back AND f.status = 'working'
           AND r.last_activity_at < now() - make_interval(mins => ${stallMinutes}::int))`,
    tx`DELETE FROM quote_lines
       WHERE NOT is_history AND source_file_id IN (
         SELECT f.id FROM source_files f, demo_run r
         WHERE r.id = 1 AND r.status = 'finished' AND f.is_held_back AND f.status = 'working'
           AND r.last_activity_at < now() - make_interval(mins => ${stallMinutes}::int))`,
    tx`UPDATE source_files f SET status = 'waiting'
       FROM demo_run r
       WHERE r.id = 1 AND r.status = 'finished' AND f.is_held_back AND f.status = 'working'
         AND r.last_activity_at < now() - make_interval(mins => ${stallMinutes}::int)`,
  ]);
}

/**
 * Finished run but the held-back file (16) is still waiting: hand out a new
 * run token so this caller can process just that file. claimSourceFile still
 * makes sure the file is processed only once.
 */
export async function claimHeldBackRun(runId: string): Promise<boolean> {
  const rows = await db()`
    UPDATE demo_run SET run_id = ${runId}::uuid, last_activity_at = now()
    WHERE id = 1 AND status = 'finished'
      AND EXISTS (SELECT 1 FROM source_files WHERE is_held_back AND status = 'waiting')
    RETURNING id
  `;
  return rows.length > 0;
}

/** running → finished once every inbox file is done or needs review. */
export async function finishDemoRunIfComplete(): Promise<boolean> {
  const rows = await db()`
    UPDATE demo_run SET status = 'finished', finished_at = now(), last_activity_at = now()
    WHERE id = 1 AND status = 'running'
      AND NOT EXISTS (
        SELECT 1 FROM source_files
        WHERE NOT is_held_back AND NOT is_upload AND status IN ('waiting', 'working'))
    RETURNING id
  `;
  return rows.length > 0;
}

/** Lines saved and open review items for one file. */
export async function countFileResults(
  fileId: number,
): Promise<{ lines: number; reviews: number }> {
  const rows = await db()`
    SELECT
      (SELECT count(*)::int FROM quote_lines
        WHERE source_file_id = ${fileId} AND NOT is_history) AS lines,
      (SELECT count(*)::int FROM review_items
        WHERE source_file_id = ${fileId} AND status = 'open') AS reviews
  `;
  return { lines: rows[0].lines as number, reviews: rows[0].reviews as number };
}

// ---------------------------------------------------------------------------
// Agent run screen (Step 6). Read-only: everything the live screen shows.
// ---------------------------------------------------------------------------

export type SnapshotFile = SourceFileWithCount & {
  supplier_initials: string | null;
  supplier_colour: string | null;
  /** UK time of the file's first event, e.g. "09:06", or null if not started. */
  started_time: string | null;
  /** ISO time of the file's latest event, for ordering. */
  last_event_at: string | null;
};

export type SnapshotLine = {
  id: number;
  source_file_id: number;
  supplier_name: string | null;
  route: string;
  category: Category | null;
  rule_number: number | null;
  price: string;
  unit_note: string | null;
  vat_note: string | null;
  status: QuoteLine["status"];
};

export type SnapshotReview = {
  id: number;
  source_file_id: number | null;
  quote_line_id: number | null;
  reason_type: ReasonType;
  status: "open" | "approved" | "edited" | "rejected";
};

export type SnapshotEvent = {
  id: number;
  source_file_id: number;
  step_number: number;
  tool_name: string;
  text: string;
  duration_ms: number | null;
  created_at: string;
  /** UK time, e.g. "09:06:12". */
  time: string;
};

export type RunSnapshot = {
  run: DemoRun;
  files: SnapshotFile[];
  lines: SnapshotLine[];
  reviews: SnapshotReview[];
  events: SnapshotEvent[];
};

export async function getRunSnapshot(): Promise<RunSnapshot> {
  const [run, files, lines, reviews, events] = await Promise.all([
    getDemoRun(),
    db()`
      SELECT f.id, f.supplier_id, s.name AS supplier_name, s.initials AS supplier_initials,
             s.colour AS supplier_colour, f.sender_name,
             f.file_name, f.file_path, f.type, f.received_at::text AS received_at,
             to_char(f.received_at AT TIME ZONE 'Europe/London', 'HH24:MI') AS received_time,
             to_char(f.received_at AT TIME ZONE 'Europe/London', 'Dy FMDD Mon') AS received_day,
             f.is_held_back, f.is_upload, f.status,
             (SELECT count(*)::int FROM quote_lines q
               WHERE q.source_file_id = f.id AND NOT q.is_history) AS lines_found,
             (SELECT count(*)::int FROM review_items r
               WHERE r.source_file_id = f.id AND r.status = 'open') AS open_reviews,
             to_char((SELECT min(e.created_at) FROM agent_events e WHERE e.source_file_id = f.id)
                     AT TIME ZONE 'Europe/London', 'HH24:MI') AS started_time,
             (SELECT max(e.created_at) FROM agent_events e WHERE e.source_file_id = f.id)::text
               AS last_event_at
      FROM source_files f
      LEFT JOIN suppliers s ON s.id = f.supplier_id
      ORDER BY f.received_at, f.id
    `,
    db()`
      SELECT q.id, q.source_file_id, s.name AS supplier_name, q.route, q.category,
             q.rule_number, q.price::text AS price, q.unit_note, q.vat_note, q.status
      FROM quote_lines q
      LEFT JOIN suppliers s ON s.id = q.supplier_id
      WHERE NOT q.is_history
      ORDER BY q.source_file_id, q.id
    `,
    db()`
      SELECT id, source_file_id, quote_line_id, reason_type, status
      FROM review_items ORDER BY id
    `,
    db()`
      SELECT id, source_file_id, step_number, tool_name, text, duration_ms,
             created_at::text AS created_at,
             to_char(created_at AT TIME ZONE 'Europe/London', 'HH24:MI:SS') AS time
      FROM agent_events ORDER BY id
    `,
  ]);
  return {
    run,
    files: files as SnapshotFile[],
    lines: lines as SnapshotLine[],
    reviews: reviews as SnapshotReview[],
    events: events as SnapshotEvent[],
  };
}

// ---------------------------------------------------------------------------
// Uploads ("Add quotes", Step 6). Kept apart from the inbox run.
// ---------------------------------------------------------------------------

/** Most uploads per reset. Counted from source_files, so reset clears it. */
export const MAX_UPLOADS = 10;

/**
 * Adds an uploaded file, already claimed (status working), unless the
 * upload limit is reached. The advisory lock makes the count-and-insert safe
 * when two uploads arrive at once. Returns the new id, or null at the limit.
 */
export async function insertUpload(file: {
  fileName: string;
  type: SourceFileType;
}): Promise<number | null> {
  const results = await db().transaction((tx) => [
    tx`SELECT pg_advisory_xact_lock(6006)`,
    tx`INSERT INTO source_files (supplier_id, sender_name, file_name, file_path, type,
                                 received_at, is_held_back, is_upload, status)
       SELECT NULL, NULL, ${file.fileName}, '', ${file.type}, now(), false, true, 'working'
       WHERE (SELECT count(*) FROM source_files WHERE is_upload) < ${MAX_UPLOADS}
       RETURNING id`,
  ]);
  const rows = results[1] as { id: number }[];
  return rows[0]?.id ?? null;
}

/** identify_supplier: sets (or clears) an upload's supplier, also on lines already saved. */
export async function setUploadSupplier(
  fileId: number,
  supplierId: number | null,
  senderName: string | null,
): Promise<void> {
  await db().transaction((tx) => [
    tx`UPDATE source_files SET supplier_id = ${supplierId}, sender_name = ${senderName}
       WHERE id = ${fileId} AND is_upload`,
    tx`UPDATE quote_lines SET supplier_id = ${supplierId}
       WHERE source_file_id = ${fileId} AND NOT is_history
         AND EXISTS (SELECT 1 FROM source_files WHERE id = ${fileId} AND is_upload)`,
  ]);
}

/** Deletes one upload with its lines, review items and events (all cascade). */
export async function deleteUpload(fileId: number): Promise<void> {
  await db()`DELETE FROM source_files WHERE id = ${fileId} AND is_upload`;
}

/**
 * Uploads still working with no activity for `stallMinutes` (their request
 * was cut off, so the clean-up after a failure never ran) are deleted with
 * their lines, review items and events, freeing their slots.
 */
export async function deleteStalledUploads(stallMinutes: number): Promise<number> {
  const rows = await db()`
    DELETE FROM source_files f
    WHERE f.is_upload AND f.status = 'working'
      AND COALESCE((SELECT max(e.created_at) FROM agent_events e WHERE e.source_file_id = f.id),
                   f.received_at) < now() - make_interval(mins => ${stallMinutes}::int)
    RETURNING f.id
  `;
  return rows.length;
}

// ---------------------------------------------------------------------------
// Review queue (Step 7)
// ---------------------------------------------------------------------------

/**
 * Approves every line the agent never flagged, once its file has finished
 * (never the held-back file 16: its quote waits for price list v4, Step 9)
 * (done or needs review). A line counts as flagged when a review item points
 * at it, or its whole file has a file-level item (unknown sender). Safe to
 * run any number of times. $1 = one file id, or null for every file.
 * Also run by `npm run db:processed` (scripts/db-setup.mjs).
 */
export const APPROVE_UNFLAGGED_SQL = `
  UPDATE quote_lines q SET status = 'approved'
  FROM source_files f
  WHERE f.id = q.source_file_id
    AND f.status IN ('done', 'needs_review')
    AND NOT f.is_held_back
    AND ($1::int IS NULL OR f.id = $1::int)
    AND NOT q.is_history
    AND q.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM review_items r WHERE r.quote_line_id = q.id)
    AND NOT EXISTS (SELECT 1 FROM review_items r
                    WHERE r.source_file_id = q.source_file_id AND r.quote_line_id IS NULL)
  RETURNING q.id`;

export async function approveUnflaggedLines(fileId: number | null = null): Promise<number> {
  const rows = await db().query(APPROVE_UNFLAGGED_SQL, [fileId]);
  return rows.length;
}

export type ReviewStatus = "approved" | "edited" | "rejected";

export type ReviewLine = {
  id: number;
  route: string;
  category: Category | null;
  rule_number: number | null;
  price: string;
  unit_note: string | null;
  vat_note: string | null;
  time_slot: TimeSlot | null;
  goods: Goods | null;
};

export type OpenReviewItem = {
  id: number;
  reason_type: ReasonType;
  reason_text: string;
  original_excerpt: string | null;
  usual_price: string | null;
  suggestion: string | null;
  status: "open" | ReviewStatus;
  source_file_id: number;
  file_name: string;
  file_path: string;
  file_type: SourceFileType;
  is_upload: boolean;
  /** UK time the file arrived, e.g. "12:10". */
  received_time: string;
  supplier_id: number | null;
  supplier_name: string | null;
  /** The flagged line, or null for a file-level item (unknown sender). */
  line: ReviewLine | null;
};

const REVIEW_ITEM_SELECT = `
  SELECT r.id, r.reason_type, r.reason_text, r.original_excerpt,
         r.usual_price::text AS usual_price, r.suggestion, r.status,
         f.id AS source_file_id, f.file_name, f.file_path, f.type AS file_type, f.is_upload,
         to_char(f.received_at AT TIME ZONE 'Europe/London', 'HH24:MI') AS received_time,
         f.supplier_id, s.name AS supplier_name,
         CASE WHEN q.id IS NULL THEN NULL ELSE json_build_object(
           'id', q.id, 'route', q.route, 'category', q.category, 'rule_number', q.rule_number,
           'price', q.price::text, 'unit_note', q.unit_note, 'vat_note', q.vat_note,
           'time_slot', q.time_slot, 'goods', q.goods) END AS line
  FROM review_items r
  LEFT JOIN quote_lines q ON q.id = r.quote_line_id
  JOIN source_files f ON f.id = COALESCE(r.source_file_id, q.source_file_id)
  LEFT JOIN suppliers s ON s.id = f.supplier_id`;

/** Review items still waiting for a person, oldest first. */
export async function listOpenReviewItems(): Promise<OpenReviewItem[]> {
  return (await db().query(
    `${REVIEW_ITEM_SELECT} WHERE r.status = 'open' ORDER BY r.created_at, r.id`,
  )) as OpenReviewItem[];
}

/** One review item (any status), or null. */
export async function getReviewItem(id: number): Promise<OpenReviewItem | null> {
  const rows = (await db().query(`${REVIEW_ITEM_SELECT} WHERE r.id = $1`, [id])) as OpenReviewItem[];
  return rows[0] ?? null;
}

export type SameJobLine = {
  id: number;
  price: string;
  status: QuoteLine["status"];
  file_name: string;
  is_upload: boolean;
  /** UK time the line's file arrived, e.g. "11:30". */
  received_time: string;
  is_flagged: boolean;
};

// The "same job" match used by duplicates: same supplier, route, category,
// time slot and goods, from a different file, never past prices. `q` is the
// flagged line, `o` the flagged line itself or another quote for the job.
const SAME_JOB = `
  NOT o.is_history AND (o.id = q.id OR (
    o.source_file_id <> q.source_file_id
    AND o.status <> 'rejected'
    AND o.supplier_id = q.supplier_id
    AND lower(o.route) = lower(q.route)
    AND o.category IS NOT DISTINCT FROM q.category
    AND o.time_slot IS NOT DISTINCT FROM q.time_slot
    AND o.goods IS NOT DISTINCT FROM q.goods))`;

/** A flagged duplicate line and every other quote for the same job, oldest first. */
export async function sameJobLines(lineId: number): Promise<SameJobLine[]> {
  return (await db().query(
    `SELECT o.id, o.price::text AS price, o.status, f.file_name, f.is_upload,
            to_char(f.received_at AT TIME ZONE 'Europe/London', 'HH24:MI') AS received_time,
            o.id = q.id AS is_flagged
     FROM quote_lines q
     JOIN quote_lines o ON ${SAME_JOB}
     JOIN source_files f ON f.id = o.source_file_id
     WHERE q.id = $1
     ORDER BY f.received_at, o.id`,
    [lineId],
  )) as SameJobLine[];
}

/** Lines saved from one file (never past prices), in saved order. */
export async function fileLines(fileId: number): Promise<ReviewLine[]> {
  return (await db().query(
    `SELECT id, route, category, rule_number, price::text AS price, unit_note, vat_note,
            time_slot, goods
     FROM quote_lines WHERE source_file_id = $1 AND NOT is_history ORDER BY id`,
    [fileId],
  )) as ReviewLine[];
}

// Every action below is ONE statement. Its first step closes the review item
// only if it is still open (UPDATE … WHERE status = 'open'); every later step
// joins to that result, so if someone else got there first nothing changes
// and `resolved` is false ("Already handled").

export type ResolvedLine = {
  id: number;
  route: string;
  price: string;
  unit_note: string | null;
  category: Category | null;
  status: QuoteLine["status"];
};

/** Price looks wrong / Unclear: approve, edit or reject the flagged line. */
export async function resolveLineItem(
  itemId: number,
  change: {
    itemStatus: ReviewStatus;
    lineStatus: "approved" | "rejected";
    price?: number | null;
    unit?: string | null;
    route?: string | null;
    category?: Category | null;
  },
): Promise<{ resolved: boolean; line: ResolvedLine | null }> {
  const rows = await db().query(
    `WITH item AS (
       UPDATE review_items SET status = $2, resolved_at = now()
       WHERE id = $1 AND status = 'open' AND reason_type IN ('price_wrong', 'unclear')
         AND quote_line_id IS NOT NULL
       RETURNING quote_line_id),
     upd AS (
       UPDATE quote_lines l SET
         status = $3,
         price = COALESCE($4::numeric, l.price),
         unit_note = COALESCE($5::text, l.unit_note),
         route = COALESCE($6::text, l.route),
         rule_number = CASE WHEN $7::text IS NOT NULL AND $7::text IS DISTINCT FROM l.category
                            THEN NULL ELSE l.rule_number END,
         category = COALESCE($7::text, l.category)
       FROM item
       WHERE l.id = item.quote_line_id AND NOT l.is_history
       RETURNING l.id, l.route, l.price::text AS price, l.unit_note, l.category, l.status)
     SELECT (SELECT count(*)::int FROM item) > 0 AS resolved,
            (SELECT row_to_json(upd) FROM upd LIMIT 1) AS line`,
    [
      itemId,
      change.itemStatus,
      change.lineStatus,
      change.price ?? null,
      change.unit ?? null,
      change.route ? tidyRoute(change.route) : null,
      change.category ?? null,
    ],
  );
  return { resolved: rows[0].resolved as boolean, line: (rows[0].line as ResolvedLine | null) ?? null };
}

/**
 * Duplicate: keep one quote for the job and reject the others. "later" keeps
 * the most recently received quote, "earlier" the first one. An optional new
 * price is set on the kept quote.
 */
export async function resolveDuplicate(
  itemId: number,
  change: { itemStatus: ReviewStatus; keep: "later" | "earlier"; price?: number | null },
): Promise<{ resolved: boolean; kept: { price: string; received_time: string } | null; rejected: number }> {
  const rows = await db().query(
    `WITH item AS (
       UPDATE review_items SET status = $2, resolved_at = now()
       WHERE id = $1 AND status = 'open' AND reason_type = 'duplicate' AND quote_line_id IS NOT NULL
       RETURNING quote_line_id),
     grp AS (
       SELECT o.id, f.received_at,
              to_char(f.received_at AT TIME ZONE 'Europe/London', 'HH24:MI') AS received_time
       FROM item
       JOIN quote_lines q ON q.id = item.quote_line_id
       JOIN quote_lines o ON ${SAME_JOB}
       JOIN source_files f ON f.id = o.source_file_id),
     keep AS (
       SELECT id, received_time FROM grp
       ORDER BY CASE WHEN $3 = 'later' THEN -extract(epoch FROM received_at)
                     ELSE extract(epoch FROM received_at) END,
                CASE WHEN $3 = 'later' THEN -id ELSE id END
       LIMIT 1),
     upd AS (
       UPDATE quote_lines l SET
         status = CASE WHEN l.id IN (SELECT id FROM keep) THEN 'approved' ELSE 'rejected' END,
         price = CASE WHEN l.id IN (SELECT id FROM keep) AND $4::numeric IS NOT NULL
                      THEN $4::numeric ELSE l.price END
       WHERE l.id IN (SELECT id FROM grp)
       RETURNING l.id, l.status, l.price::text AS price)
     SELECT (SELECT count(*)::int FROM item) > 0 AS resolved,
            (SELECT json_build_object('price', u.price, 'received_time', k.received_time)
               FROM upd u JOIN keep k ON k.id = u.id) AS kept,
            (SELECT count(*)::int FROM upd WHERE status = 'rejected') AS rejected`,
    [itemId, change.itemStatus, change.keep, change.price ?? null],
  );
  return {
    resolved: rows[0].resolved as boolean,
    kept: (rows[0].kept as { price: string; received_time: string } | null) ?? null,
    rejected: rows[0].rejected as number,
  };
}

/**
 * Unknown sender. With a supplier: it is set on the file and on all its
 * lines, and the lines (those with no open item of their own) are approved.
 * With null (Reject): every line from the file is rejected.
 */
export async function resolveUnknownSender(
  itemId: number,
  change: { itemStatus: ReviewStatus; supplierId: number | null },
): Promise<{ resolved: boolean; lines: number }> {
  const rows = await db().query(
    `WITH item AS (
       UPDATE review_items SET status = $2, resolved_at = now()
       WHERE id = $1 AND status = 'open' AND reason_type = 'unknown_sender'
         AND source_file_id IS NOT NULL
         AND ($3::int IS NULL OR EXISTS (SELECT 1 FROM suppliers WHERE id = $3::int))
       RETURNING source_file_id),
     file AS (
       UPDATE source_files sf SET
         supplier_id = $3::int,
         sender_name = COALESCE(sf.sender_name, (SELECT name FROM suppliers WHERE id = $3::int))
       FROM item
       WHERE sf.id = item.source_file_id AND $3::int IS NOT NULL
       RETURNING sf.id),
     lines AS (
       UPDATE quote_lines q SET
         supplier_id = COALESCE($3::int, q.supplier_id),
         status = CASE
           WHEN $3::int IS NULL THEN 'rejected'
           WHEN q.status = 'pending' AND NOT EXISTS (
             SELECT 1 FROM review_items r WHERE r.quote_line_id = q.id AND r.status = 'open')
             THEN 'approved'
           ELSE q.status END
       FROM item
       WHERE q.source_file_id = item.source_file_id AND NOT q.is_history
       RETURNING q.id)
     SELECT (SELECT count(*)::int FROM item) > 0 AS resolved,
            (SELECT count(*)::int FROM lines) AS lines,
            (SELECT count(*)::int FROM file) AS files`,
    [itemId, change.itemStatus, change.supplierId],
  );
  return { resolved: rows[0].resolved as boolean, lines: rows[0].lines as number };
}
