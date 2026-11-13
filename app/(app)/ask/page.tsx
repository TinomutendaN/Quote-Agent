import Link from "next/link";
import { Suspense } from "react";
import { DashedPill, PanelFact, StatusBox, StatusCard } from "@/components/Cards";
import { PageHeader } from "@/components/PageHeader";
import { getNewQuote, listCurrentPriceLines, listNewQuoteLines, listPriceLists } from "@/lib/db";
import { buildBaseRows, newQuoteChanges, priceLabel, unitKey } from "@/lib/pricing";
import { AskView } from "./AskView";

export default function AskPage() {
  return (
    <>
      <PageHeader breadcrumb="Ask" title="Ask about your prices" beta />
      <Suspense fallback={null}>
        <NewQuoteCard />
      </Suspense>
      <AskView />
    </>
  );
}

const reviewButton =
  "inline-flex min-h-11 flex-none items-center rounded-btn bg-primary px-4 text-[13px] font-semibold tracking-[0.03em] text-white no-underline hover:bg-primary-hover hover:text-white";

/**
 * The held-back M6 Express quote (file 16). Hidden until the agent has read it;
 * waits for "Review vN" until a saved version approves it.
 */
async function NewQuoteCard() {
  const [quote, lines, newLines, lists] = await Promise.all([
    getNewQuote(),
    listCurrentPriceLines(),
    listNewQuoteLines(),
    listPriceLists(),
  ]);
  if (!quote || quote.lines.length === 0 || !["done", "needs_review"].includes(quote.file_status)) return null;

  const inReview = quote.lines.some((l) => l.status === "pending" && l.in_review);
  const allApproved = quote.lines.every((l) => l.status === "approved");
  const waiting = newLines.length > 0;
  if (!waiting && !inReview && !allApproved) return null; // e.g. rejected in the review queue

  const nextVersion = (lists.filter((l) => l.status === "saved")[0]?.version ?? 0) + 1;
  const approvedOnly = lines.filter((l) => !newLines.some((n) => n.id === l.id));
  const changes = newQuoteChanges(buildBaseRows(approvedOnly), newLines);
  const supplier = quote.supplier ?? "Unknown sender";
  const shownLines = quote.lines.filter((l) => l.status !== "rejected");
  const title = `${supplier} – ${shownLines
    .map((l) => `${l.route} ${priceLabel(Number(l.price), unitKey(l.unit_note))}`)
    .join(", ")}`;

  const panel = (
    <>
      {allApproved ? (
        <StatusBox label="Approved" colour="#1E7A44" icon="tick" />
      ) : (
        <StatusBox label="New quote" colour="#1D4ED8" />
      )}
      <PanelFact value="Arrived" caption={quote.received_label} />
    </>
  );

  return (
    <StatusCard colour={allApproved ? "#BDEBD3" : "#B9D6FB"} panel={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-medium">{title}</h2>
      </div>

      {allApproved ? (
        <>
          <DashedPill>
            <TickIcon />
            Approved – now in the price list
          </DashedPill>
          <p className="m-0 text-[15px] leading-normal">
            The quote was approved when the new price list version was saved.{" "}
            <Link href="/pricing" className="font-semibold">
              Open price lists
            </Link>
          </p>
        </>
      ) : inReview ? (
        <>
          <DashedPill tone="warn">The agent sent this quote to the review queue</DashedPill>
          <p className="m-0 text-[15px] leading-normal">
            Something in it needs a person to check.{" "}
            <Link href="/review" className="font-semibold">
              Open review queue
            </Link>
          </p>
        </>
      ) : (
        <>
          <DashedPill>
            <TickIcon />
            Handled automatically – waiting for your approval
          </DashedPill>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 flex-[1_1_320px] text-[15px] leading-normal">
              {sentence(changes)} Draft price list v{nextVersion} is ready.
            </p>
            <Link href="/pricing?with=new" className={reviewButton}>
              REVIEW V{nextVersion}
            </Link>
          </div>
        </>
      )}
    </StatusCard>
  );
}

/** "The agent read the email, sorted the job as Standard and found it is **8% cheaper** than Swift Haul Ltd." */
function sentence(changes: ReturnType<typeof newQuoteChanges>) {
  if (changes.length !== 1) {
    const cheaper = changes.filter((c) => c.wins).length;
    return (
      <>
        The agent read the email and sorted {changes.length} jobs; <strong>{cheaper}</strong> of them would lower
        the price list.
      </>
    );
  }
  const c = changes[0];
  const start = `The agent read the email, sorted the job as ${c.row.category} and found it is `;
  if (!c.current) return <>{start.replace(/ and found it is $/, "")}. It&apos;s a new route for the price list.</>;
  if (c.cheaperPct !== null && c.cheaperPct > 0)
    return (
      <>
        {start}
        <strong>{c.cheaperPct}% cheaper</strong> than {c.current.supplier}.
      </>
    );
  if (c.wins)
    return (
      <>
        {start}
        <strong>slightly cheaper</strong> than {c.current.supplier}.
      </>
    );
  return (
    <>
      {start}
      <strong>{Math.abs(c.cheaperPct ?? 0)}% dearer</strong> than {c.current.supplier}, so the list keeps{" "}
      {c.current.supplier}.
    </>
  );
}

function TickIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}
