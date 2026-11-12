import type { ReactNode } from "react";
import { HistoryArrows } from "./HistoryArrows";

/**
 * Top of every app page: back/forward arrows and breadcrumb on the left,
 * action buttons on the right, then the page title. Page tabs go below it
 * (see PageTabs).
 */
export function PageHeader({
  breadcrumb,
  title,
  beta = false,
  actions,
}: {
  breadcrumb: string;
  title: string;
  beta?: boolean;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[15px]">
          <HistoryArrows />
          <span>{breadcrumb}</span>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-5">{actions}</div>}
      </div>
      <div className="flex items-center gap-3">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">{title}</h1>
        {beta && (
          <span className="rounded-btn bg-butter px-2 py-[3px] text-[11px] font-semibold text-on-butter">
            BETA
          </span>
        )}
      </div>
    </>
  );
}

/** Uppercase header button. `primary` is the solid blue one. */
export function HeaderButton({
  children,
  primary = false,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  primary?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-btn px-4 text-[13px] font-semibold tracking-[0.03em] ${
        primary
          ? "border border-primary bg-primary text-white hover:bg-primary-hover"
          : "border border-line-strong bg-white text-ink hover:bg-well"
      }`}
    >
      {children}
    </button>
  );
}
