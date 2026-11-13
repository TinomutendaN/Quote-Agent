import { Suspense } from "react";
import { countOpenReviewItems } from "@/lib/db";
import { Icon } from "./Icon";
import { NavLinks } from "./NavLinks";
import { ResetDemo } from "./ResetDemo";

export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="box-border flex max-w-full flex-[1_1_230px] flex-col gap-0.5 border-r border-line bg-white px-3.5 py-[22px] print:hidden"
    >
      <div className="flex items-center gap-2.5 px-2.5 pb-[22px]">
        <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-ink text-white">
          <Icon name="logo" size={17} strokeWidth={2.2} />
        </span>
        <span className="text-[22px] font-bold tracking-[-0.02em]">Quote Agent</span>
      </div>

      <div className="px-3 pt-6 pb-2 text-xs font-semibold tracking-[0.04em] text-muted">
        MAIN MENU
      </div>

      <NavLinks
        reviewBadge={
          <Suspense fallback={null}>
            <ReviewBadge />
          </Suspense>
        }
      />

      <div className="mt-auto flex flex-col gap-0.5 px-3 pt-4 text-xs text-muted">
        <span>Northline Couriers · sample data</span>
        <ResetDemo />
      </div>
    </nav>
  );
}

/** Number of open review items, straight from the database. Hidden at zero. */
async function ReviewBadge() {
  const count = await countOpenReviewItems();
  if (count === 0) return null;
  return (
    <span
      className="rounded-full bg-badge px-2 py-px text-xs font-semibold text-on-badge"
      aria-label={`${count} waiting for review`}
    >
      {count}
    </span>
  );
}
