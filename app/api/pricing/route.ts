// POST /api/pricing  { version, standard_markup, signature }
// Saves the current draft price list as a new version. The rows are rebuilt
// here from the approved quotes (never taken from the browser) and priced with
// the chosen markup. Refused with 409 when:
//   - the approved quotes changed since the page was opened (signature differs),
//   - the draft is identical to the latest saved version ("No changes since vN"),
//   - someone else saved this version number first.
// Open review items don't block saving; the message mentions them.
import { z } from "zod";
import { countOpenReviewItems, listCurrentPriceLines, listPriceLists, savePriceList } from "@/lib/db";
import {
  MARKUP_CHOICES,
  buildBaseRows,
  listSignature,
  markupFor,
  priceRows,
  sameList,
} from "@/lib/pricing";

const Body = z.object({
  version: z.number().int().positive(),
  standard_markup: z.number().refine((n) => (MARKUP_CHOICES as readonly number[]).includes(n)),
  signature: z.string().min(1).max(100),
});

const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });

const LABEL_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Please choose a markup of 15, 25 or 35% and try again.", 400);
  const body = parsed.data;

  try {
    const [lines, lists, openItems] = await Promise.all([
      listCurrentPriceLines(),
      listPriceLists(),
      countOpenReviewItems(),
    ]);
    const saved = lists.filter((l) => l.status === "saved");
    const latest = saved[0] ?? null;
    const nextVersion = (latest?.version ?? 0) + 1;

    if (body.version !== nextVersion) {
      return fail(`Someone else just saved v${nextVersion - 1} – refresh to see it.`, 409);
    }

    const base = buildBaseRows(lines);
    if (listSignature(base) !== body.signature) {
      return fail(
        "The approved quotes changed since you opened this page – refresh to see the latest list.",
        409,
      );
    }
    if (base.length === 0) {
      return fail("There are no approved quotes to save yet.", 409);
    }

    const markup = markupFor(body.standard_markup);
    const rows = priceRows(base, markup);
    if (latest && sameList(latest.rows, rows)) {
      return fail(`No changes since v${latest.version}.`, 409);
    }

    const label = `Saved ${LABEL_TIME.format(new Date())}`; // "Saved 13 Nov, 14:05"
    const ok = await savePriceList({ version: nextVersion, label, markup, rows });
    if (!ok) return fail(`Someone else just saved v${nextVersion} – refresh to see it.`, 409);

    const waiting =
      openItems === 0
        ? ""
        : ` – ${openItems} ${openItems === 1 ? "quote was" : "quotes were"} still waiting for review`;
    return Response.json({ ok: true, version: nextVersion, message: `Saved v${nextVersion}${waiting}.` });
  } catch (err) {
    console.error("Saving the price list failed:", err);
    return fail("Something went wrong saving the price list – try again.", 500);
  }
}
