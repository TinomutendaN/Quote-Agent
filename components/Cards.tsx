import type { CSSProperties, ReactNode } from "react";
import { ClockIcon, Icon } from "./Icon";

const cardShell =
  "flex overflow-hidden rounded-card border border-line bg-white shadow-card";

/**
 * Card with a coloured left status panel (Inbox, Agent run, Price lists, Ask).
 * `panel` holds the status box and facts; `children` is the card body.
 * On narrow screens the panel wraps above the body.
 */
export function StatusCard({
  colour,
  panel,
  children,
  hidePanelInPrint = false,
}: {
  colour: string;
  panel: ReactNode;
  children: ReactNode;
  /** Leave the status panel out of printouts (Price lists Export PDF). */
  hidePanelInPrint?: boolean;
}) {
  return (
    <article className={`${cardShell} flex-wrap`}>
      <div
        className={`flex flex-[1_1_128px] flex-col gap-[18px] p-2 ${hidePanelInPrint ? "print:hidden" : ""}`}
        style={{ background: colour }}
      >
        {panel}
      </div>
      <div className="flex min-w-0 flex-[999_1_460px] flex-col gap-3.5 px-[22px] py-[18px]">
        {children}
      </div>
    </article>
  );
}

/** White box at the top of a status panel: icon plus a status word. */
export function StatusBox({
  label,
  colour,
  icon = "clock",
}: {
  label: string;
  colour: string;
  icon?: "clock" | "tick";
}) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 rounded-btn bg-white px-2 py-3.5 text-center"
      style={{ color: colour }}
    >
      {icon === "tick" ? <Icon name="tick" size={22} strokeWidth={1.8} /> : <ClockIcon />}
      <span className="text-[13px] font-semibold">{label}</span>
    </div>
  );
}

/** A bold fact and a caption, inside a status panel. */
export function PanelFact({ value, caption }: { value: ReactNode; caption: ReactNode }) {
  return (
    <div className="px-1.5 text-[13px] leading-[1.4]">
      <strong>{value}</strong>
      <br />
      {caption}
    </div>
  );
}

export function PanelDivider() {
  return <div className="mx-1.5 h-px bg-ink/20" />;
}

/** Card with a thin 24px colour strip on its left edge (Review queue). */
export function StripCard({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <article className={cardShell}>
      <div aria-hidden="true" className="flex-[0_0_24px] self-stretch" style={{ background: colour }} />
      <div className="flex min-w-0 flex-auto flex-col gap-3.5 px-[22px] py-[18px]">{children}</div>
    </article>
  );
}

/** Card title, e.g. "Pennine Freight – 4 quotes". */
export function CardTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="m-0 text-lg font-medium">{children}</h2>
      {extra}
    </div>
  );
}

/** Dashed pill: green for "all good" notes, amber for warnings. */
export function DashedPill({
  tone = "ok",
  children,
}: {
  tone?: "ok" | "warn";
  children: ReactNode;
}) {
  const tones =
    tone === "ok"
      ? "border-ok-line bg-ok-bg text-on-mint"
      : "border-warn-line bg-warn-bg text-warn-text";
  return (
    <span
      className={`inline-flex items-center gap-2 self-start rounded-btn border-[1.5px] border-dashed px-3 py-[7px] text-[13px] font-medium ${tones}`}
    >
      {tone === "warn" && <Icon name="warning" size={16} strokeWidth={1.8} />}
      {children}
    </span>
  );
}

/** Grey header pill (e.g. "08:12", "RULE 1", "STEP 2"). */
export function GreyPill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`rounded-pill bg-pill p-1 text-center text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Tile with a grey pill on top and a bordered box below.
 * `pillExtra` sits to the right of the pill (e.g. the double-arrow icon).
 */
export function PillTile({
  pill,
  pillExtra,
  children,
  shadow = false,
  style,
  className = "",
}: {
  pill: ReactNode;
  pillExtra?: ReactNode;
  children: ReactNode;
  shadow?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`} style={style}>
      {pillExtra ? (
        <div className="flex items-center gap-2">
          <GreyPill className="flex-1">{pill}</GreyPill>
          {pillExtra}
        </div>
      ) : (
        <GreyPill>{pill}</GreyPill>
      )}
      <div
        className={`flex flex-col gap-2.5 rounded-btn border border-line-soft p-3 ${
          shadow ? "shadow-tile" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** Small round initials badge in a supplier's colour. */
export function InitialsCircle({ initials, colour }: { initials: string; colour: string }) {
  return (
    <span
      className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-bold"
      style={{ background: colour }}
    >
      {initials}
    </span>
  );
}
