// Checks the price list maths against hand calculations, with no model calls.
// Usage: npm run db:processed && npm run pricing:check
//
// 1. Pure maths: sell = cost × (1 + markup), worked out by hand for a few rows.
// 2. Seeded versions: v1 vs v2 must differ by exactly the 3 Swift Haul routes.
// 3. Draft v3 from the database. The expected numbers depend on the review
//    queue: with the 4 fixture items still open ("before review"), or after all
//    4 were approved in the browser ("after review").
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBaseRows,
  compareVersions,
  formatMoney,
  listSignature,
  markupFor,
  newQuoteChanges,
  newQuoteNote,
  priceLabel,
  priceRow,
  priceRows,
  sameList,
  serviceLabel,
  totals,
  typicalCost,
} from "../lib/pricing.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const db = await import("../lib/db.ts");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`);
}

// ---------------------------------------------------------------------------
console.log("\n1. Hand calculations (sell = cost × (1 + markup))");
const row = (route, category, cost, extra = {}) => ({
  route, category, time_slot: "weekday", goods: "general", unit: "per job", supplier: "x", cost, ...extra,
});
const hand = [
  [row("London → Manchester", "Standard", 295), [339.25, 368.75, 398.25]],
  [row("Leeds → Leeds (local)", "Out-of-hours", 205, { time_slot: "evening" }), [256.25, 276.75, 297.25]],
  [row("Southmead Hospital → Filton", "Specialist", 240, { goods: "chilled_medical" }), [312, 336, 360]],
  [row("Manchester → Leeds", "Standard", 85, { unit: "per pallet" }), [97.75, 106.25, 114.75]],
  [row("Bristol Zone 1 → Bristol Zone 1", "Standard", 42), [48.3, 52.5, 56.7]],
];
for (const [r, sells] of hand) {
  [15, 25, 35].forEach((m, i) => {
    const p = priceRow(r, markupFor(m));
    check(`${r.route} (${serviceLabel(r)}) £${r.cost} at ${m}% → ${p.markup_pct}%`, [p.sell, p.margin],
      [sells[i], Math.round((sells[i] - r.cost) * 100) / 100]);
  });
}
check("markup 25 → 25 / 35 / 40", markupFor(25), { standard: 25, out_of_hours: 35, specialist: 40 });
check("money format", ["£206", "£206.25", "£206.50", "£21,089", "£27,296.75"].join(" "),
  [206, 206.25, 206.5, 21089, 27296.75].map(formatMoney).join(" "));
check("price with unit", [priceLabel(193.75, "per pallet"), priceLabel(368.75, "per job")],
  ["£193.75 per pallet", "£368.75"]);
check("service labels",
  [serviceLabel({ category: "Out-of-hours", time_slot: "overnight", goods: "general" }),
   serviceLabel({ category: "Specialist", time_slot: "weekday", goods: "chilled_medical" }),
   serviceLabel({ category: "Standard", time_slot: "weekday", goods: "general" })],
  ["Out-of-hours · overnight", "Specialist · chilled", "Standard"]);
check("cheapest per job wins, units kept apart",
  buildBaseRows([
    { id: 1, route: "A → B", category: "Standard", time_slot: "weekday", goods: "general", unit_note: "per job", supplier: "P", price: "120.00", quote_date: "2026-11-11" },
    { id: 2, route: "a → b", category: "Standard", time_slot: "weekday", goods: "general", unit_note: null, supplier: "Q", price: "110.00", quote_date: "2026-11-11" },
    { id: 3, route: "A → B", category: "Standard", time_slot: "weekday", goods: "general", unit_note: "Per pallet", supplier: "R", price: "60.00", quote_date: "2026-11-11" },
    { id: 4, route: "A → B", category: "Out-of-hours", time_slot: "weekend", goods: "general", unit_note: "per job", supplier: "S", price: "150.00", quote_date: "2026-11-11" },
  ]).map((r) => `${r.supplier} ${r.cost} ${r.unit} ${r.time_slot}`),
  ["Q 110 per job weekday", "R 60 per pallet weekday", "S 150 per job weekend"]);

// ---------------------------------------------------------------------------
console.log("\n2. Seeded versions v1 and v2");
const lists = await db.listPriceLists();
const v1 = lists.find((l) => l.version === 1);
const v2 = lists.find((l) => l.version === 2);
check("v1 row format", Object.keys(v1.rows[0]).sort(),
  ["category", "cost", "goods", "margin", "markup_pct", "route", "sell", "supplier", "time_slot", "unit"]);
const t1 = totals(v1.rows);
const t2 = totals(v2.rows);
check("v1 totals", [t1.rows, t1.cost, t1.sell], [15, 3081, 3991.05]);
check("v2 totals", [t2.rows, t2.cost, t2.sell], [15, 3051, 3952.55]);
const d12 = compareVersions(v1.rows, v2.rows);
check("v1 → v2: added / removed / changed", [d12.added.length, d12.removed.length, d12.changed.length], [0, 0, 3]);
check("v1 → v2 changes",
  d12.changed.map((c) => `${c.after.supplier}: ${c.after.route} ${serviceLabel(c.after)} £${c.before.cost}→£${c.after.cost} sell £${c.before.sell}→£${c.after.sell}`).sort(),
  [
    "Swift Haul Ltd: London → Birmingham Standard £215→£205 sell £268.75→£256.25",
    "Swift Haul Ltd: London → Manchester Out-of-hours · weekend £335→£325 sell £452.25→£438.75",
    "Swift Haul Ltd: London → Manchester Standard £295→£285 sell £368.75→£356.25",
  ]);
// v1/v2 rows must match what lib/pricing.ts would build from the same past prices.
check("seed.sql maths = lib/pricing.ts maths (v2)", sameList(v2.rows, priceRows(v2.rows, v2.markup)), true);

// ---------------------------------------------------------------------------
const openItems = await db.countOpenReviewItems();
const state = openItems === 4 ? "before" : openItems === 0 ? "after" : null;
console.log(`\n3. Draft list from the database (${openItems} open review items → ${state ?? "unknown"} review)`);
const base = buildBaseRows(await db.listCurrentPriceLines());
const expected = {
  before: { rows: 119, split: [79, 22, 18], cost: 21089, sells: [25187.85, 27296.75, 29405.65], added: 104, satLM: 340 },
  after: { rows: 126, split: [86, 22, 18], cost: 21894, sells: [26111.6, 28301, 30490.4], added: 111, satLM: 320 },
}[state];
// Once the new quote is approved (by saving vN from "Review vN"), M6's £270
// replaces Swift Haul's £295 for weekday London → Manchester.
const m6Approved = (await db.listNewQuoteLines()).length === 0;
if (expected && m6Approved) {
  expected.cost -= 25;
  expected.sells = expected.sells.map((s, i) => Math.round((s - [28.75, 31.25, 33.75][i]) * 100) / 100);
}
const lmExpected = m6Approved ? ["M6 Express", 270] : ["Swift Haul Ltd", 295];
if (!expected) {
  console.log("     Skipped: run npm run db:processed (4 open items) or approve all 4 items first.");
} else {
  const split = ["Standard", "Out-of-hours", "Specialist"].map((c) => base.filter((r) => r.category === c).length);
  check("rows and Standard / Out-of-hours / Specialist", [base.length, split], [expected.rows, expected.split]);
  [15, 25, 35].forEach((m, i) => {
    const rows = priceRows(base, markupFor(m));
    const t = totals(rows);
    // Hand check of the margin: each category's cost × its own markup.
    const byCat = (c) => base.filter((r) => r.category === c).reduce((s, r) => s + Math.round(r.cost * 100), 0);
    const margin = Math.round(byCat("Standard") * m / 100 + byCat("Out-of-hours") * (m + 10) / 100 + byCat("Specialist") * (m + 15) / 100) / 100;
    check(`${m}%: cost / sell / margin`, [t.cost, t.sell], [expected.cost, expected.sells[i]]);
    check(`${m}%: margin = Σ cost × category markup (±1p per row)`, Math.abs(t.margin - margin) <= rows.length * 0.01, true);
  });
  const lm = base.find((r) => r.route === "London → Manchester" && r.category === "Standard");
  check(`London → Manchester weekday: ${lmExpected.join(" £")}`, [lm.supplier, lm.cost], lmExpected);
  const sat = base.find((r) => r.route === "London → Manchester" && r.time_slot === "weekend");
  check("Saturday London → Manchester", sat.cost, expected.satLM);
  const v2v3 = compareVersions(v2.rows, priceRows(base, markupFor(25)));
  check("v2 → v3 at 25%: added / removed / changed", [v2v3.added.length, v2v3.removed.length, v2v3.changed.length], [expected.added, 0, 15]);
}

// ---------------------------------------------------------------------------
console.log("\n4. The new quote (file 16) and Ask figures");
check("typical cost rounds to the pound", [typicalCost([295, 270]), typicalCost(["295.00"]), typicalCost(["100.00", "101.00"])], [283, 295, 101]);
const files = await db.listSourceFiles();
const held = files.find((f) => f.is_held_back);
check("file 16 finished", held.status, "done");
const current = await db.listCurrentPriceLines();
const newLines = await db.listNewQuoteLines();
const approvedM6 = current.filter((l) => l.route === "London → Manchester" && l.supplier === "M6 Express" && Number(l.price) === 270);
if (newLines.length > 0) {
  check("file 16's £270 line is waiting, not approved", [newLines.length, approvedM6.length], [1, 0]);
  const approvedBase = buildBaseRows(current);
  const [change] = newQuoteChanges(approvedBase, newLines);
  check("new quote vs current list", [change.current?.supplier, change.current?.cost, change.row.cost, change.cheaperPct, change.wins],
    ["Swift Haul Ltd", 295, 270, 8, true]);
  check("new quote note", newQuoteNote(change), "London → Manchester: M6 Express £270, was Swift Haul Ltd £295");
  const withNew = buildBaseRows([...current, ...newLines]);
  const lm = withNew.find((r) => r.route === "London → Manchester" && r.category === "Standard");
  check("draft with the new quote: same rows, London → Manchester M6 £270", [withNew.length, lm.supplier, lm.cost], [approvedBase.length, "M6 Express", 270]);
  check("signature changes with the new quote", listSignature(withNew) !== listSignature(approvedBase), true);
} else {
  check("file 16's £270 line was approved by saving a version", approvedM6.length, 1);
  const withM6 = lists.filter((l) => l.rows.some((r) => r.route === "London → Manchester" && r.supplier === "M6 Express" && r.cost === 270));
  check("the version that added M6 Express £270 is labelled after it", withM6.at(-1)?.label, "M6 Express update");
}

console.log(failures === 0 ? "\nAll price list checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
