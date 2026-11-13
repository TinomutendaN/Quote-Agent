// Review queue helpers shared by the screen and /api/review. No imports with
// side effects, safe in the browser.
import type { IconName } from "@/components/Icon";
import type { ReasonType, ReviewLine } from "./db";
import { formatMoney } from "./pricing";

/** Colour strip on each review card, by reason (from docs/design/review.dc.html). */
export const REASON_STRIP: Record<ReasonType, string> = {
  price_wrong: "#FBBDAB",
  duplicate: "#CDBDF2",
  unclear: "#B9D6FB",
  unknown_sender: "#FBBDAB",
};

/** Reason tabs. Unknown sender has no tab of its own; it shows under All. */
export type ReasonTab = "all" | "price_wrong" | "duplicate" | "unclear";

export const REASON_TABS: { key: ReasonTab; label: string; icon: IconName }[] = [
  { key: "all", label: "ALL", icon: "all" },
  { key: "price_wrong", label: "PRICE LOOKS WRONG", icon: "warning" },
  { key: "duplicate", label: "DUPLICATES", icon: "duplicate" },
  { key: "unclear", label: "UNCLEAR", icon: "question" },
];

export const SERVICES = ["Standard", "Out-of-hours", "Specialist"] as const;

/** "£480", "£155.50" (same rule as the price lists). */
export function formatPrice(price: string | number): string {
  return formatMoney(price);
}

const SLOT_WORD: Record<string, string> = {
  weekend: "Weekend",
  evening: "Evening",
  overnight: "Overnight",
};

/** "Weekend London → Manchester", or just the route for weekday jobs. */
export function jobName(line: Pick<ReviewLine, "route" | "time_slot">): string {
  const slot = line.time_slot ? SLOT_WORD[line.time_slot] : undefined;
  return slot ? `${slot} ${line.route}` : line.route;
}

/** "London → Manchester (weekend)", for the details row. */
export function routeDetail(line: Pick<ReviewLine, "route" | "time_slot">): string {
  const slot = line.time_slot ? SLOT_WORD[line.time_slot] : undefined;
  return slot ? `${line.route} (${slot.toLowerCase()})` : line.route;
}

/**
 * The price and unit the agent suggests for an unclear line, e.g. "Record the
 * per-pallet price as £155 (£310 divided by 2)." → £155 per pallet. Falls back
 * to dividing the price by the count in the unit note ("total for 2 pallets").
 * null when neither works (Approve then asks the person to use Edit).
 */
export function unclearFix(
  suggestion: string | null,
  line: Pick<ReviewLine, "price" | "unit_note">,
): { price: number; unit: string } | null {
  const text = suggestion ?? "";
  const unitMatch =
    text.match(/\bper[\s-]+([a-z]+)/i) ?? (line.unit_note ?? "").match(/\d+\s+([a-z]+?)s?\b/i);
  const unit = unitMatch ? `per ${unitMatch[1].toLowerCase().replace(/s$/, "")}` : null;

  const amount = text.match(/£\s?(\d[\d,]*(?:\.\d{1,2})?)/);
  if (amount && unit) {
    const price = Number(amount[1].replace(/,/g, ""));
    if (price > 0) return { price, unit };
  }

  const count = (line.unit_note ?? "").match(/(\d+)\s+([a-z]+?)s?\b/i);
  if (count && Number(count[1]) > 1) {
    const price = Math.round((Number(line.price) / Number(count[1])) * 100) / 100;
    return { price, unit: `per ${count[2].toLowerCase()}` };
  }
  return null;
}
