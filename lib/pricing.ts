// Price list building, markup maths and version comparison. Plain TypeScript,
// no AI and no imports with side effects, so it is safe in the browser and is
// reused by the Price lists screen, /api/pricing and (Step 9) the Ask tools.
//
// Money is worked out in whole pence so totals never drift; rows store pounds
// to the penny (e.g. 368.75).

export type Category = "Standard" | "Out-of-hours" | "Specialist";
export type TimeSlot = "weekday" | "evening" | "overnight" | "weekend";
export type Goods = "general" | "chilled_medical" | "fragile" | "secure";

/** One approved quote line, as read by listCurrentPriceLines() in lib/db.ts. */
export type PriceLine = {
  id: number;
  route: string;
  category: Category;
  time_slot: TimeSlot | null;
  goods: Goods | null;
  unit_note: string | null;
  supplier: string;
  price: string | number;
  /** "2026-11-11" */
  quote_date: string | null;
};

/** A price list row before markup: the cheapest approved quote for one job. */
export type BaseRow = {
  route: string;
  category: Category;
  time_slot: TimeSlot;
  goods: Goods;
  /** "per job", "per pallet", … */
  unit: string;
  supplier: string;
  cost: number;
};

/** A priced row. Saved versions store exactly this shape in price_lists.rows. */
export type PriceRow = BaseRow & {
  markup_pct: number;
  sell: number;
  margin: number;
};

export type Markup = { standard: number; out_of_hours: number; specialist: number };

/** The Standard markup choices on screen. */
export const MARKUP_CHOICES = [15, 25, 35] as const;
export const DEFAULT_MARKUP = 25;
/** Points added on top of the Standard markup. */
export const CATEGORY_EXTRAS = { out_of_hours: 10, specialist: 15 } as const;

const CATEGORY_ORDER: Category[] = ["Standard", "Out-of-hours", "Specialist"];
const SLOT_ORDER: TimeSlot[] = ["weekday", "evening", "overnight", "weekend"];
const GOODS_ORDER: Goods[] = ["general", "chilled_medical", "fragile", "secure"];

const toPence = (pounds: string | number) => Math.round(Number(pounds) * 100);
const toPounds = (pence: number) => pence / 100;

/** "per job" unless the line says otherwise; lower case, spaces tidied. */
export function unitKey(unit: string | null | undefined): string {
  const text = (unit ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return text === "" || text === "per job" ? "per job" : text;
}

/** Two rows are the same job when route, service, time slot, goods and unit all match. */
export function rowKey(r: Pick<BaseRow, "route" | "category" | "time_slot" | "goods" | "unit">): string {
  const route = r.route.trim().replace(/\s+/g, " ").toLowerCase();
  return [route, r.category, r.time_slot, r.goods, unitKey(r.unit)].join("|");
}

function compareRows(a: BaseRow, b: BaseRow): number {
  return (
    a.route.localeCompare(b.route, "en-GB") ||
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
    SLOT_ORDER.indexOf(a.time_slot) - SLOT_ORDER.indexOf(b.time_slot) ||
    GOODS_ORDER.indexOf(a.goods) - GOODS_ORDER.indexOf(b.goods) ||
    a.unit.localeCompare(b.unit)
  );
}

/**
 * Cheapest approved quote per route + service + time slot + goods + unit.
 * Ties go to the most recent quote, then the earliest saved line.
 */
export function buildBaseRows(lines: PriceLine[]): BaseRow[] {
  const best = new Map<string, { line: PriceLine; row: BaseRow }>();
  for (const line of lines) {
    const row: BaseRow = {
      route: line.route.trim().replace(/\s+/g, " "),
      category: line.category,
      time_slot: line.time_slot ?? "weekday",
      goods: line.goods ?? "general",
      unit: unitKey(line.unit_note),
      supplier: line.supplier,
      cost: toPounds(toPence(line.price)),
    };
    const key = rowKey(row);
    const current = best.get(key);
    const better =
      !current ||
      row.cost < current.row.cost ||
      (row.cost === current.row.cost &&
        ((line.quote_date ?? "") > (current.line.quote_date ?? "") ||
          ((line.quote_date ?? "") === (current.line.quote_date ?? "") && line.id < current.line.id)));
    if (better) best.set(key, { line, row });
  }
  return [...best.values()].map((b) => b.row).sort(compareRows);
}

/** Standard markup plus the fixed extras: 25 → {25, 35, 40}. */
export function markupFor(standard: number): Markup {
  return {
    standard,
    out_of_hours: standard + CATEGORY_EXTRAS.out_of_hours,
    specialist: standard + CATEGORY_EXTRAS.specialist,
  };
}

export function markupPctFor(category: Category, markup: Markup): number {
  if (category === "Out-of-hours") return markup.out_of_hours;
  if (category === "Specialist") return markup.specialist;
  return markup.standard;
}

/** sell = cost × (1 + markup), rounded to the penny; margin = sell − cost. */
export function priceRow(row: BaseRow, markup: Markup): PriceRow {
  const pct = markupPctFor(row.category, markup);
  const cost = toPence(row.cost);
  const sell = Math.round((cost * (100 + pct)) / 100);
  return { ...row, markup_pct: pct, sell: toPounds(sell), margin: toPounds(sell - cost) };
}

export function priceRows(rows: BaseRow[], markup: Markup): PriceRow[] {
  return rows.map((r) => priceRow(r, markup));
}

export type Totals = {
  rows: number;
  cost: number;
  sell: number;
  margin: number;
  /** Margin as a share of sales, 0–100, e.g. 22.7 */
  marginPct: number;
};

export function totals(rows: PriceRow[]): Totals {
  let cost = 0;
  let sell = 0;
  for (const r of rows) {
    cost += toPence(r.cost);
    sell += toPence(r.sell);
  }
  return {
    rows: rows.length,
    cost: toPounds(cost),
    sell: toPounds(sell),
    margin: toPounds(sell - cost),
    marginPct: sell === 0 ? 0 : ((sell - cost) / sell) * 100,
  };
}

export type RowChange = { before: PriceRow; after: PriceRow };
export type Comparison = { added: PriceRow[]; removed: PriceRow[]; changed: RowChange[] };

/** What changed from version a to version b, matched on rowKey. */
export function compareVersions(a: PriceRow[], b: PriceRow[]): Comparison {
  const before = new Map(a.map((r) => [rowKey(r), r]));
  const after = new Map(b.map((r) => [rowKey(r), r]));
  const added: PriceRow[] = [];
  const removed: PriceRow[] = [];
  const changed: RowChange[] = [];
  for (const [key, row] of after) {
    const old = before.get(key);
    if (!old) added.push(row);
    else if (
      old.supplier !== row.supplier ||
      toPence(old.cost) !== toPence(row.cost) ||
      Number(old.markup_pct) !== Number(row.markup_pct) ||
      toPence(old.sell) !== toPence(row.sell)
    ) {
      changed.push({ before: old, after: row });
    }
  }
  for (const [key, row] of before) if (!after.has(key)) removed.push(row);
  return { added, removed, changed };
}

/** True when two lists have exactly the same rows and prices. */
export function sameList(a: PriceRow[], b: PriceRow[]): boolean {
  const c = compareVersions(a, b);
  return c.added.length === 0 && c.removed.length === 0 && c.changed.length === 0;
}

/**
 * Short fingerprint of the approved quotes behind a draft. The browser sends
 * it with Save, so the server can tell if the quotes changed in the meantime.
 */
export function listSignature(rows: BaseRow[]): string {
  const text = rows.map((r) => `${rowKey(r)}|${r.supplier}|${toPence(r.cost)}`).join(";");
  let hash = 0x811c9dc5; // FNV-1a, 32-bit
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${rows.length}-${hash.toString(16)}`;
}

const wholePounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const withPence = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "£206", "£206.25", "£206.50", "£21,089". */
export function formatMoney(amount: string | number): string {
  const pence = toPence(amount);
  return pence % 100 === 0 ? wholePounds.format(pence / 100) : withPence.format(pence / 100);
}

/** "£155 per pallet", or just "£295" for per-job prices. */
export function priceLabel(amount: number, unit: string): string {
  const u = unitKey(unit);
  return u === "per job" ? formatMoney(amount) : `${formatMoney(amount)} ${u}`;
}

const SLOT_LABEL: Record<TimeSlot, string> = {
  weekday: "weekday",
  evening: "evening",
  overnight: "overnight",
  weekend: "weekend",
};
const GOODS_LABEL: Record<Goods, string> = {
  general: "general",
  chilled_medical: "chilled",
  fragile: "fragile",
  secure: "secure",
};

/** "Standard", "Out-of-hours · overnight", "Specialist · chilled". */
export function serviceLabel(r: Pick<BaseRow, "category" | "time_slot" | "goods">): string {
  const parts: string[] = [r.category];
  if (r.time_slot && r.time_slot !== "weekday") parts.push(SLOT_LABEL[r.time_slot]);
  if (r.goods && r.goods !== "general") parts.push(GOODS_LABEL[r.goods]);
  return parts.join(" · ");
}

/** "+£10", "−£12.50" */
export function formatChange(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${formatMoney(Math.abs(amount))}`;
}
