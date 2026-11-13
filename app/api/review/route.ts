// POST /api/review  { item_id, action: "approve" | "edit" | "reject", …edit fields }
// Resolves one review item. "Approve" applies the agent's suggestion:
//   Price looks wrong – Approve keeps the quoted price, Edit changes it, Reject rejects the line.
//   Duplicate         – Approve keeps the later quote and rejects the earlier one; Edit picks
//                       which to keep (and can set its price); Reject keeps the earlier one.
//   Unclear           – Approve applies the suggested price and unit; Edit sets them; Reject
//                       rejects the line.
//   Unknown sender    – Approve and Edit need a supplier_id: it is set on the file and its
//                       lines, which are approved. Reject rejects every line from the file.
// Each action is one atomic statement in lib/db.ts that only runs while the item
// is still open, so a second visitor gets 409 "Already handled".
import { z } from "zod";
import {
  type ReviewStatus,
  getReviewItem,
  listSuppliers,
  resolveDuplicate,
  resolveLineItem,
  resolveUnknownSender,
} from "@/lib/db";
import { SERVICES, formatPrice, unclearFix } from "@/lib/review";

const Price = z.number().positive().max(100000);
const Body = z.object({
  item_id: z.number().int().positive(),
  action: z.enum(["approve", "edit", "reject"]),
  price: Price.nullish(),
  unit: z.string().trim().min(1).max(60).nullish(),
  route: z.string().trim().min(3).max(120).nullish(),
  category: z.enum(SERVICES).nullish(),
  keep: z.enum(["later", "earlier"]).nullish(),
  supplier_id: z.number().int().positive().nullish(),
});

const ALREADY_HANDLED = "Already handled – someone else has dealt with this one.";

const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });
const done = (message: string) => Response.json({ ok: true, message });

const STATUS_FOR: Record<"approve" | "edit" | "reject", ReviewStatus> = {
  approve: "approved",
  edit: "edited",
  reject: "rejected",
};

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("Please check the values you entered – a price must be a number above zero.", 400);
  }
  const body = parsed.data;
  const item = await getReviewItem(body.item_id);
  if (!item) return fail("That review item couldn't be found.", 404);
  if (item.status !== "open") return fail(ALREADY_HANDLED, 409);

  const itemStatus = STATUS_FOR[body.action];

  try {
    switch (item.reason_type) {
      case "price_wrong":
      case "unclear": {
        if (!item.line) return fail("This item has no price attached.", 422);
        let change: Parameters<typeof resolveLineItem>[1];
        if (body.action === "reject") {
          change = { itemStatus, lineStatus: "rejected" };
        } else if (body.action === "edit") {
          if (body.price == null) return fail("Enter the price to save.", 400);
          change = {
            itemStatus,
            lineStatus: "approved",
            price: body.price,
            unit: item.reason_type === "unclear" ? body.unit : undefined,
            route: body.route,
            category: body.category,
          };
        } else if (item.reason_type === "unclear") {
          // Worked out here from the stored suggestion, never taken from the browser.
          const fix = unclearFix(item.suggestion, item.line);
          if (!fix) return fail("The agent's suggestion has no price to apply – use Edit instead.", 422);
          change = { itemStatus, lineStatus: "approved", price: fix.price, unit: fix.unit };
        } else {
          change = { itemStatus, lineStatus: "approved" };
        }
        const result = await resolveLineItem(item.id, change);
        if (!result.resolved || !result.line) return fail(ALREADY_HANDLED, 409);
        const l = result.line;
        const unit = l.unit_note ? ` ${l.unit_note}` : "";
        return done(
          l.status === "rejected"
            ? `Rejected – ${l.route} won't be used in price lists.`
            : `${body.action === "edit" ? "Saved" : "Approved"} – ${l.route} at ${formatPrice(l.price)}${unit}.`,
        );
      }

      case "duplicate": {
        const keep = body.action === "reject" ? "earlier" : body.action === "edit" ? (body.keep ?? "later") : "later";
        const result = await resolveDuplicate(item.id, {
          itemStatus,
          keep,
          price: body.action === "edit" ? body.price : null,
        });
        if (!result.resolved || !result.kept) return fail(ALREADY_HANDLED, 409);
        return done(
          `Kept ${formatPrice(result.kept.price)} from the quote received at ${result.kept.received_time}` +
            (result.rejected > 0 ? `; the other quote is rejected.` : "."),
        );
      }

      case "unknown_sender": {
        let supplierId: number | null = null;
        let supplierName = "";
        if (body.action !== "reject") {
          if (!body.supplier_id) return fail("Choose the supplier first.", 400);
          const supplier = (await listSuppliers()).find((s) => s.id === body.supplier_id);
          if (!supplier) return fail("That supplier couldn't be found.", 400);
          supplierId = supplier.id;
          supplierName = supplier.name;
        }
        const result = await resolveUnknownSender(item.id, { itemStatus, supplierId });
        if (!result.resolved) return fail(ALREADY_HANDLED, 409);
        const prices = `${result.lines} ${result.lines === 1 ? "price" : "prices"}`;
        return done(
          supplierId === null
            ? `Rejected – the ${prices} from this file won't be used.`
            : `Set to ${supplierName} – ${prices} approved.`,
        );
      }
    }
  } catch (error) {
    console.error(`[review] item ${item.id}:`, error instanceof Error ? error.message : error);
    return fail("Something went wrong saving that – try again.", 500);
  }
}
