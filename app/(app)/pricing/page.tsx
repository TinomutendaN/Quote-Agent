import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  countOpenReviewItems,
  listCurrentPriceLines,
  listNewQuoteLines,
  listPriceLists,
  listWaitingPriceLines,
} from "@/lib/db";
import { buildBaseRows, listSignature, newQuoteChanges, newQuoteNote, rowKey } from "@/lib/pricing";
import { PricingView } from "./PricingView";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader breadcrumb="Price lists" title="Price lists" />
          <p className="m-0 text-sm text-slate">Loading the price lists…</p>
        </>
      }
    >
      <PricingData searchParams={searchParams} />
    </Suspense>
  );
}

async function PricingData({ searchParams }: { searchParams: SearchParams }) {
  const [params, lines, waitingLines, newLines, lists, openItems] = await Promise.all([
    searchParams,
    listCurrentPriceLines(),
    listWaitingPriceLines(),
    listNewQuoteLines(),
    listPriceLists(),
    countOpenReviewItems(),
  ]);

  // "Review vN" on Ask opens /pricing?with=new: the draft includes the new quote.
  const includeNew = params.with === "new" && newLines.length > 0;
  const approvedBase = buildBaseRows(lines);
  const base = includeNew ? buildBaseRows([...lines, ...newLines]) : approvedBase;
  const newNotes = newQuoteChanges(approvedBase, newLines).map(newQuoteNote);

  // Jobs that only have quotes still waiting for review, for "X/Y Routes approved".
  const inList = new Set(base.map(rowKey));
  const waitingRoutes = buildBaseRows(waitingLines).filter((r) => !inList.has(rowKey(r))).length;

  const saved = lists
    .filter((l) => l.status === "saved")
    .map((l) => ({
      version: l.version,
      label: l.label,
      created: l.created_label,
      markup: l.markup,
      rows: l.rows,
    }));

  return (
    <PricingView
      // A fresh view (markup, tabs) when switching in or out of the new quote.
      key={includeNew ? "with-new" : "approved"}
      base={base}
      signature={listSignature(base)}
      saved={saved}
      waitingRoutes={waitingRoutes}
      openItems={openItems}
      newQuote={{ included: includeNew, waiting: newLines.length, notes: newNotes }}
    />
  );
}
