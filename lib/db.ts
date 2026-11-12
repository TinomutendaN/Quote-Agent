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
           f.is_held_back, f.is_upload, f.status
    FROM source_files f
    LEFT JOIN suppliers s ON s.id = f.supplier_id
    ORDER BY f.received_at, f.id
  `) as SourceFile[];
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
