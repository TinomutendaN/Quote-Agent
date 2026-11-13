// The three read-only Ask tools. Each calls fixed queries in lib/db.ts and the
// maths in lib/pricing.ts; nothing here writes to the database, and past
// prices (is_history) are never read.
//
// Every result carries two lists our code fills, which the model never sees
// (toModelOutput strips them):
//   sources – the quotes behind the result, shown as "Quotes used" with Open links
//   lists   – the price list versions used, shown as "From price lists: …"
// All money is formatted here, so the model only has to copy figures.
import { tool } from "ai";
import { z } from "zod";
import {
  type ApprovedQuote,
  type Category,
  type PriceList,
  approvedQuotesById,
  listCurrentPriceLines,
  listPriceLists,
  queryApprovedQuotes,
} from "@/lib/db";
import {
  DEFAULT_MARKUP,
  type PriceRow,
  buildBaseRowsWithSources,
  compareVersions,
  formatChange,
  formatMoney,
  markupFor,
  priceLabel,
  priceRows,
  rowKey,
  sameList,
  serviceLabel,
  totals,
  typicalCost,
  unitKey,
} from "@/lib/pricing";

/** One row of "Quotes used". */
export type AskSource = {
  id: number;
  supplier: string;
  initials: string;
  colour: string;
  /** "London → Manchester · £295 · Standard · 3 Nov" */
  detail: string;
  /** "/samples/11_Swift_Haul_rates_Nov.xlsx", or null for uploads. */
  href: string | null;
};

type WithSources = { sources: AskSource[]; lists: string[] };

/** Most rows of each kind shown to the model in one result. */
const MAX_JOBS = 80;
const MAX_ROWS = 40;
const MAX_CHANGES = 30;

const SERVICES = ["Standard", "Out-of-hours", "Specialist"] as const;
const place = z.string().trim().min(2).max(60);

function toSource(q: ApprovedQuote): AskSource {
  const service = serviceLabel({
    category: q.category,
    time_slot: q.time_slot ?? "weekday",
    goods: q.goods ?? "general",
  });
  const parts = [q.route, priceLabel(Number(q.price), unitKey(q.unit_note)), service];
  if (q.day_label) parts.push(q.day_label);
  return {
    id: q.id,
    supplier: q.supplier,
    initials: q.supplier_initials,
    colour: q.supplier_colour,
    detail: parts.join(" · "),
    href: !q.is_upload && q.file_path ? q.file_path : null,
  };
}

/** Strips the screen-only lists before the result goes back to the model. */
function forModel(output: unknown) {
  const { sources, lists, ...rest } = output as Record<string, unknown> & Partial<WithSources>;
  void sources;
  void lists;
  return { type: "json" as const, value: JSON.parse(JSON.stringify(rest)) };
}

const matches = (text: string, word: string | undefined) =>
  !word || text.toLowerCase().includes(word.trim().toLowerCase());

function rowMatches(r: PriceRow, f: { service?: Category; place?: string }) {
  const [from = "", to = ""] = r.route.split(" → ");
  return (!f.service || r.category === f.service) && (!f.place || matches(from, f.place) || matches(to, f.place));
}

// ---------------------------------------------------------------------------
// Price list versions, as the tools see them
// ---------------------------------------------------------------------------

type Version = {
  version: number;
  draft: boolean;
  /** For the model: "v3 draft (not saved yet) at the default 25% markup" */
  label: string;
  /** For the screen: "v3 draft at 25% markup" */
  short: string;
  rows: PriceRow[];
  /** Draft only: rowKey → quote line id. */
  sourceIds: Map<string, number>;
};

const markupText = (m: { standard: number; out_of_hours: number; specialist: number }) =>
  `${m.standard}% Standard, ${m.out_of_hours}% Out-of-hours, ${m.specialist}% Specialist`;

async function loadVersions(): Promise<{ saved: Version[]; draft: Version; latest: number }> {
  const [lists, lines] = await Promise.all([listPriceLists(), listCurrentPriceLines()]);
  const saved = lists
    .filter((l: PriceList) => l.status === "saved")
    .map((l) => ({
      version: l.version,
      draft: false,
      label: `v${l.version} – saved price list "${l.label}" (${l.created_label}), markup ${markupText(l.markup)}`,
      short: `v${l.version} · ${l.label}`,
      rows: l.rows,
      sourceIds: new Map<string, number>(),
    }));
  const latest = saved[0]?.version ?? 0;
  // The current list: approved quotes only, so the waiting new quote isn't in it.
  const { rows, sourceIds } = buildBaseRowsWithSources(lines);
  const markup = markupFor(DEFAULT_MARKUP);
  const draftRows = priceRows(rows, markup);

  // Nothing changed since the latest saved version: the current list *is* that
  // version, so call it "saved vN (no changes since)", never "vN+1 draft". Its
  // rows are the approved quotes', so the quotes behind them can still be shown.
  if (saved[0] && rows.length > 0 && sameList(saved[0].rows, draftRows)) {
    const current: Version = {
      ...saved[0],
      label: `${saved[0].label} – the current list, no changes since it was saved`,
      short: `saved v${latest} (no changes since)`,
      sourceIds,
    };
    return { saved: [current, ...saved.slice(1)], draft: current, latest };
  }

  const draft: Version = {
    version: latest + 1,
    draft: true,
    label: `v${latest + 1} draft – the current list, not saved yet, built from approved quotes at the default markup (${markupText(markup)})`,
    short: `v${latest + 1} draft at ${DEFAULT_MARKUP}% markup`,
    rows: draftRows,
    sourceIds,
  };
  return { saved, draft, latest };
}

function pickVersion(all: { saved: Version[]; draft: Version }, version: number | undefined): Version | null {
  if (version === undefined || version === all.draft.version) return all.draft;
  return all.saved.find((v) => v.version === version) ?? null;
}

function noSuchVersion(all: { saved: Version[]; draft: Version }, version: number) {
  const saved = all.saved.map((v) => `v${v.version}`).reverse().join(", ") || "none";
  return {
    error: `There is no price list v${version}. Saved versions: ${saved}. The current draft is v${all.draft.version}.`,
    sources: [],
    lists: [],
  };
}

/**
 * Quotes behind rows of the current list. Older saved versions are snapshots
 * with no quote links (their sourceIds map is empty).
 */
async function draftSources(v: Version, rows: PriceRow[]): Promise<AskSource[]> {
  if (v.sourceIds.size === 0) return [];
  const ids = rows.map((r) => v.sourceIds.get(rowKey(r))).filter((id): id is number => id !== undefined);
  return (await approvedQuotesById([...new Set(ids)])).map(toSource);
}

const showRow = (r: PriceRow) => ({
  route: r.route,
  service: serviceLabel(r),
  supplier: r.supplier,
  cost: priceLabel(r.cost, r.unit),
  markup: `${r.markup_pct}%`,
  sell: priceLabel(r.sell, r.unit),
  margin: formatMoney(r.margin),
});

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

export function createAskTools() {
  return {
    query_approved_quotes: tool({
      description:
        "Approved supplier quotes (never past prices), grouped into jobs (route + service). For each job: how many quotes, every supplier's price, the cheapest, and the typical cost (average, rounded to the pound). Use for typical costs, cheapest supplier, and what a supplier quoted.",
      inputSchema: z.object({
        place: place.optional().describe("A town that is either end of the route, e.g. Leeds"),
        origin: place.optional().describe("Where the route starts, e.g. London"),
        destination: place.optional().describe("Where the route ends, e.g. Manchester"),
        supplier: z.string().trim().min(2).max(60).optional().describe("Supplier name or part of it"),
        service: z.enum(SERVICES).optional(),
      }),
      execute: async (input) => {
        const quotes = await queryApprovedQuotes({ ...input, category: input.service ?? null });
        const jobs = new Map<string, ApprovedQuote[]>();
        for (const q of quotes) {
          const key = rowKey({
            route: q.route,
            category: q.category,
            time_slot: q.time_slot ?? "weekday",
            goods: q.goods ?? "general",
            unit: unitKey(q.unit_note),
          });
          jobs.set(key, [...(jobs.get(key) ?? []), q]);
        }
        const wins = new Map<string, number>();
        const jobList = [...jobs.values()].map((qs) => {
          const sorted = [...qs].sort((a, b) => Number(a.price) - Number(b.price));
          const unit = unitKey(sorted[0].unit_note);
          const cheapest = sorted[0];
          const tied = sorted.filter((q) => Number(q.price) === Number(cheapest.price)).map((q) => q.supplier);
          for (const s of new Set(tied)) wins.set(s, (wins.get(s) ?? 0) + 1);
          return {
            route: cheapest.route,
            service: serviceLabel({
              category: cheapest.category,
              time_slot: cheapest.time_slot ?? "weekday",
              goods: cheapest.goods ?? "general",
            }),
            unit,
            number_of_quotes: qs.length,
            quotes: sorted.map((q) => `${q.supplier} ${priceLabel(Number(q.price), unit)}`).join(", "),
            cheapest: `${[...new Set(tied)].join(" and ")} ${priceLabel(Number(cheapest.price), unit)}`,
            typical_cost: priceLabel(typicalCost(qs.map((q) => q.price)), unit),
          };
        });
        return {
          filter: input,
          number_of_quotes: quotes.length,
          number_of_jobs: jobList.length,
          jobs: jobList.slice(0, MAX_JOBS),
          ...(jobList.length > MAX_JOBS ? { note: `Only the first ${MAX_JOBS} jobs are shown.` } : {}),
          cheapest_on_most_jobs: [...wins]
            .sort((a, b) => b[1] - a[1])
            .map(([s, n]) => `${s}: cheapest on ${n} of ${jobList.length} jobs`),
          sources: quotes.map(toSource),
          lists: [],
        };
      },
      toModelOutput: ({ output }) => forModel(output),
    }),

    get_price_list: tool({
      description:
        "A price list with its rows (route, service, supplier, cost, markup, sell price, margin) and totals for the rows shown, including margin as a share of sales. Leave version out for the current list (the draft built from approved quotes at the default 25% markup).",
      inputSchema: z.object({
        version: z.number().int().positive().optional().describe("A version number, e.g. 2. Leave out for the current list."),
        service: z.enum(SERVICES).optional(),
        place: place.optional().describe("Only routes starting or ending here"),
      }),
      execute: async (input) => {
        const all = await loadVersions();
        const v = pickVersion(all, input.version);
        if (!v) return noSuchVersion(all, input.version!);
        const rows = v.rows.filter((r) => rowMatches(r, input));
        const t = totals(rows);
        const shown = rows.slice(0, MAX_ROWS);
        return {
          list: v.label,
          latest_saved_version: all.latest ? `v${all.latest}` : "none",
          filter: { service: input.service ?? "all", place: input.place ?? "all" },
          number_of_rows: rows.length,
          totals_for_these_rows: {
            supplier_cost: formatMoney(t.cost),
            selling_price: formatMoney(t.sell),
            margin: formatMoney(t.margin),
            margin_share_of_sales: `${t.marginPct.toFixed(1)}%`,
          },
          rows: shown.map(showRow),
          ...(rows.length > MAX_ROWS ? { note: `Only the first ${MAX_ROWS} of ${rows.length} rows are shown; the totals cover all of them.` } : {}),
          sources: await draftSources(v, shown),
          lists: [v.short],
        };
      },
      toModelOutput: ({ output }) => forModel(output),
    }),

    compare_versions: tool({
      description:
        "What changed between two price list versions: prices changed, rows added and rows removed. Leave 'to' out to compare with the latest saved version, or with the current draft when nothing newer than 'from' is saved. The result says which lists were compared.",
      inputSchema: z.object({
        from: z.number().int().positive().describe("The older version, e.g. 2"),
        to: z.number().int().positive().optional().describe("The newer version. Leave out for the latest."),
      }),
      execute: async (input) => {
        const all = await loadVersions();
        const before = pickVersion(all, input.from);
        if (!before) return noSuchVersion(all, input.from);
        const toVersion = input.to ?? (all.latest > input.from ? all.latest : all.draft.version);
        const after = pickVersion(all, toVersion);
        if (!after) return noSuchVersion(all, toVersion);

        const diff = compareVersions(before.rows, after.rows);
        const changed = diff.changed.slice(0, MAX_CHANGES);
        const added = diff.added.slice(0, MAX_CHANGES);
        const removed = diff.removed.slice(0, MAX_CHANGES);
        const more = (n: number, kind: string) => (n > MAX_CHANGES ? [`Only the first ${MAX_CHANGES} of ${n} ${kind} rows are shown.`] : []);
        return {
          from: before.label,
          to: after.label,
          summary: `${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed`,
          changed: changed.map(({ before: b, after: a }) => {
            const delta = Math.round((a.sell - b.sell) * 100) / 100;
            const pct = b.sell === 0 ? 0 : (delta / b.sell) * 100;
            return {
              route: a.route,
              service: serviceLabel(a),
              supplier: b.supplier === a.supplier ? a.supplier : `${b.supplier} → ${a.supplier}`,
              cost: `${priceLabel(b.cost, b.unit)} → ${priceLabel(a.cost, a.unit)}`,
              sell: `${priceLabel(b.sell, b.unit)} → ${priceLabel(a.sell, a.unit)}`,
              sell_change: `${formatChange(delta)} (${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%)`,
            };
          }),
          added: added.map(showRow),
          removed: removed.map(showRow),
          notes: [...more(diff.changed.length, "changed"), ...more(diff.added.length, "added"), ...more(diff.removed.length, "removed")],
          sources: await draftSources(after, [...changed.map((c) => c.after), ...added]),
          lists: [before.short, after.short],
        };
      },
      toModelOutput: ({ output }) => forModel(output),
    }),
  };
}

export type AskToolName = keyof ReturnType<typeof createAskTools>;
