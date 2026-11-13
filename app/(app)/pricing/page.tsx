import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  countOpenReviewItems,
  listCurrentPriceLines,
  listPriceLists,
  listWaitingPriceLines,
} from "@/lib/db";
import { buildBaseRows, listSignature, rowKey } from "@/lib/pricing";
import { PricingView } from "./PricingView";

export default function PricingPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader breadcrumb="Price lists" title="Price lists" />
          <p className="m-0 text-sm text-slate">Loading the price lists…</p>
        </>
      }
    >
      <PricingData />
    </Suspense>
  );
}

async function PricingData() {
  const [lines, waitingLines, lists, openItems] = await Promise.all([
    listCurrentPriceLines(),
    listWaitingPriceLines(),
    listPriceLists(),
    countOpenReviewItems(),
  ]);

  const base = buildBaseRows(lines);
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
      base={base}
      signature={listSignature(base)}
      saved={saved}
      waitingRoutes={waitingRoutes}
      openItems={openItems}
    />
  );
}
