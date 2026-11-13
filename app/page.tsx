import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { LandingQuoteTabs } from "./LandingQuoteTabs";

// Landing page (docs/design/landing.dc.html). The before/after card is the
// design's own illustration of file 01, not live data.

/** Recording of the demo (Step 12). Until it's set the button shows as "coming soon". */
const TUTORIAL_URL = process.env.NEXT_PUBLIC_TUTORIAL_URL?.trim() || null;

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <header className="box-border flex flex-wrap items-center justify-between gap-4 border-b border-line bg-white px-4 py-[18px] sm:px-12">
        <div className="flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-ink text-white">
            <Icon name="logo" size={17} strokeWidth={2.2} />
          </span>
          <span className="text-[22px] font-bold tracking-[-0.02em]">Quote Agent</span>
          <span className="rounded-[4px] bg-butter px-2 py-[3px] text-[11px] font-semibold text-on-butter">
            BETA
          </span>
        </div>
      </header>

      <main className="mx-auto box-border flex w-full max-w-[1220px] flex-1 flex-col gap-12 px-4 py-10 sm:px-12 sm:py-14">
        <div className="flex flex-wrap items-center gap-12">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[22px]">
            <span className="text-xs font-semibold tracking-[0.06em] text-muted">
              AI AGENT FOR SUPPLIER QUOTES
            </span>
            <h1 className="m-0 text-[36px] leading-[1.08] font-semibold tracking-[-0.02em] sm:text-[48px]">
              Turn messy supplier quotes into clean price lists in minutes.
            </h1>
            <p className="m-0 text-lg leading-[1.55] text-slate">
              Emails, PDFs and spreadsheets. The agent reads them, sorts every job using your
              rules, stops to ask about anything odd, then builds your customer and internal price
              lists.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/inbox"
                className="inline-flex min-h-12 items-center gap-2 rounded-btn bg-primary px-[22px] text-sm font-semibold tracking-[0.03em] text-white no-underline hover:bg-primary-hover"
              >
                <Icon name="plus" size={16} strokeWidth={2} />
                TRY THE AGENT
              </Link>
              {TUTORIAL_URL ? (
                <a
                  href={TUTORIAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center gap-2 rounded-btn border border-line-strong bg-white px-[22px] text-sm font-semibold tracking-[0.03em] text-ink no-underline"
                >
                  <PlayTriangle />
                  TUTORIAL VIDEO
                </a>
              ) : (
                // No recording yet: shown, but clearly not clickable.
                <span
                  aria-disabled="true"
                  title="The tutorial video is coming soon"
                  className="inline-flex min-h-12 cursor-default items-center gap-2 rounded-btn border border-line-strong bg-white px-[22px] text-sm font-semibold tracking-[0.03em] text-muted"
                >
                  <PlayTriangle />
                  TUTORIAL VIDEO
                </span>
              )}
            </div>
            <p className="m-0 text-[13px] text-muted">
              No signup. Sample data is a fictional courier company, Northline Couriers.
            </p>
          </div>

          <BeforeAfterCard />
        </div>

        <div className="flex flex-wrap gap-4">
          <Feature number={1} colour="bg-sky" title="Reads anything">
            Emails, PDFs, scans and spreadsheets with any column names.
          </Feature>
          <Feature number={2} colour="bg-salmon" title="Asks before guessing">
            Odd prices, duplicates and gaps wait for your approval.
          </Feature>
          <Feature number={3} colour="bg-lavender" title="Builds your price lists">
            Set a markup, save versions, export a PDF for customers.
          </Feature>
        </div>
      </main>
    </div>
  );
}

function PlayTriangle() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3l16 9-16 9z" />
    </svg>
  );
}

function BeforeAfterCard() {
  return (
    <article className="flex min-w-0 flex-[1_1_520px] flex-wrap overflow-hidden rounded-card border border-line bg-white shadow-float">
      <div className="flex flex-[1_1_128px] flex-col gap-[18px] bg-salmon p-2">
        <div className="flex flex-col items-center gap-1.5 rounded-btn bg-white px-2 py-3.5">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C42B0E" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span className="text-[13px] font-semibold text-on-salmon">1 to check</span>
        </div>
        <div className="px-1.5 text-[13px] leading-[1.4]">
          <strong>3</strong>
          <br />
          Prices found
        </div>
        <div className="mx-1.5 h-px bg-[rgba(27,36,64,0.2)]" />
        <div className="px-1.5 text-[13px] leading-[1.4]">
          <strong>Cleaned in</strong>
          <br />4 seconds
        </div>
      </div>

      <LandingQuoteTabs />
    </article>
  );
}

function Feature({
  number,
  colour,
  title,
  children,
}: {
  number: number;
  colour: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-[1_1_260px] overflow-hidden rounded-card border border-line bg-white">
      <div className={`flex flex-[0_0_56px] items-center justify-center text-xl font-bold ${colour}`}>
        {number}
      </div>
      <div className="flex flex-col gap-1.5 p-[18px]">
        <strong className="text-[15px] font-semibold">{title}</strong>
        <span className="text-sm leading-normal text-slate">{children}</span>
      </div>
    </div>
  );
}
