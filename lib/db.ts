// Database client and every SQL query (fixed and parameterised).
// The model never writes SQL: agent and Ask tools call functions in this file.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

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

export type PriceListRow = {
  route: string;
  category: Category;
  supplier: string;
  cost: number;
  markup_pct: number;
  sell: number;
  margin: number;
};

export type PriceList = {
  id: number;
  version: number;
  label: string;
  status: "draft" | "saved";
  markup: { standard: number; out_of_hours: number; specialist: number };
  rows: PriceListRow[];
  created_at: string;
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

/** All source files with their supplier name, oldest first. */
export async function listSourceFiles(): Promise<SourceFile[]> {
  return (await db()`
    SELECT f.id, f.supplier_id, s.name AS supplier_name, f.sender_name,
           f.file_name, f.file_path, f.type, f.received_at::text AS received_at,
           to_char(f.received_at AT TIME ZONE 'Europe/London', 'HH24:MI') AS received_time,
           to_char(f.received_at AT TIME ZONE 'Europe/London', 'Dy FMDD Mon') AS received_day,
           f.is_held_back, f.is_upload, f.status
    FROM source_files f
    LEFT JOIN suppliers s ON s.id = f.supplier_id
    ORDER BY f.received_at, f.id
  `) as SourceFile[];
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
    SELECT id, version, label, status, markup, rows, created_at::text AS created_at
    FROM price_lists
    ORDER BY version DESC
  `) as PriceList[];
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
