"use client";

import { type ReactNode, useState } from "react";

// Right side of the landing page's before/after card: the same sample quote
// (file 01) as it arrived (Original) and after the agent sorted it (Cleaned).

type Tab = "original" | "cleaned";

const TABS: { key: Tab; label: string }[] = [
  { key: "original", label: "ORIGINAL" },
  { key: "cleaned", label: "CLEANED" },
];

export function LandingQuoteTabs() {
  const [tab, setTab] = useState<Tab>("cleaned");

  return (
    <div className="flex min-w-0 flex-[999_1_360px] flex-col gap-3.5 px-[22px] py-[18px]">
      <h2 className="m-0 text-lg font-medium">Pennine Freight – RE: Leeds run tmrw</h2>
      <div
        role="tablist"
        aria-label="Sample quote"
        className="flex gap-[18px] border-b border-line-soft text-xs font-semibold tracking-[0.03em]"
      >
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={`-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-0 py-2 text-xs font-semibold tracking-[0.03em] ${
                on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "original" ? <Original /> : <Cleaned />}
    </div>
  );
}

/** The email as it arrived, before the agent touched it. */
function Original() {
  return (
    <div role="tabpanel" className="flex flex-col gap-2.5 rounded-btn bg-well px-3 py-2.5 text-[13px] leading-[1.6] text-slate">
      <div className="text-xs text-muted">
        From: Dan Price, Pennine Freight · Wed 11 Nov, 08:12
      </div>
      <p className="m-0">Morning,</p>
      <p className="m-0">
        Yes we can cover the Leeds run tmrw. Local multi-drop in Leeds, van and driver, we can do £165 for
        the day.
      </p>
      <p className="m-0">
        If you need the evening slot as well (after 6) its £40 extra on top, so £205 all in for that one.
      </p>
      <p className="m-0">
        Also re your other q, Manc–London 2 pallets £310 ex vat. Can collect Thurs am, delivered Fri.
      </p>
      <p className="m-0">
        Cheers,
        <br />
        Dan
      </p>
    </div>
  );
}

/** What the agent made of it. */
function Cleaned() {
  return (
    <div role="tabpanel" className="flex flex-col gap-3.5">
      <div className="rounded-btn bg-well px-3 py-2.5 text-[13px] leading-[1.6] text-slate">
        “for the Leeds run tmrw we can do £165 + fuel, evening slot extra 40. Manc–London 2 pallets £310 ex
        vat. Cheers, Dan”
      </div>
      <span className="inline-flex items-center gap-2 self-start rounded-btn border-[1.5px] border-dashed border-ok-line bg-ok-bg px-3 py-[7px] text-[13px] font-medium text-on-mint">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12l5 5 9-10" />
        </svg>
        Sorted using your rules
      </span>
      <div className="flex flex-wrap gap-2.5">
        <Sorted label="STANDARD">
          Leeds local
          <br />
          <strong>£165</strong>
        </Sorted>
        <Sorted label="OUT-OF-HOURS">
          Leeds after 6pm
          <br />
          <strong>£205</strong>
        </Sorted>
        <Sorted label="CHECK" check>
          Manc → London
          <br />
          <strong>£310</strong> for 2 pallets?
        </Sorted>
      </div>
    </div>
  );
}

function Sorted({ label, check = false, children }: { label: string; check?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-[1_1_140px] flex-col gap-1.5">
      <span
        className={`rounded-pill p-1 text-center text-[11px] font-semibold ${check ? "bg-badge text-on-badge" : "bg-pill"}`}
      >
        {label}
      </span>
      <div className="rounded-btn border border-line-soft p-2.5 text-[13px] leading-normal">{children}</div>
    </div>
  );
}
