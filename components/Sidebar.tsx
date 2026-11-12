import { Suspense } from "react";
import { countOpenReviewItems } from "@/lib/db";
import { Icon } from "./Icon";
import { NavLinks } from "./NavLinks";

// "Reset demo" is built in Step 10. Until then the link stays hidden.
const SHOW_RESET_DEMO = false;

export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="box-border flex max-w-full flex-[1_1_230px] flex-col gap-0.5 border-r border-line bg-white px-3.5 py-[22px]"
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
        {SHOW_RESET_DEMO && (
          <a
            href="#"
            className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold no-underline"
          >
            <Icon name="reset" size={14} strokeWidth={2} />
            Reset demo
          </a>
        )}
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
