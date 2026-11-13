"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { DashedPill, PanelDivider, PanelFact, StatusBox, StatusCard } from "@/components/Cards";
import { HeaderButton, PageHeader } from "@/components/PageHeader";
import { CardTabs, PageTabs } from "@/components/Tabs";
import {
  type BaseRow,
  CATEGORY_EXTRAS,
  DEFAULT_MARKUP,
  MARKUP_CHOICES,
  type Markup,
  type PriceRow,
  compareVersions,
  formatChange,
  formatMoney,
  markupFor,
  priceLabel,
  priceRows,
  sameList,
  serviceLabel,
  totals,
} from "@/lib/pricing";

export type SavedVersion = {
  version: number;
  label: string;
  /** "15 Oct 2026, 09:00" */
  created: string;
  markup: Markup;
  rows: PriceRow[];
};

type PageTab = "current" | "versions" | "compare";
type ListTab = "customer" | "internal";
type Notice = { text: string; tone: "ok" | "warn" };

/** The new quote (held-back file 16) – see "Ask + new quote" in CLAUDE.md. */
export type NewQuoteInfo = {
  /** True when the draft includes it (/pricing?with=new). */
  included: boolean;
  /** Lines waiting to be approved by saving the next version. */
  waiting: number;
  /** "London → Manchester: M6 Express £270, was Swift Haul £295" */
  notes: string[];
};

/** Carries the "Saved vN" message across the switch from ?with=new back to /pricing. */
const NOTICE_KEY = "pricing-notice";

const COMPANY = "Northline Couriers";

export function PricingView({
  base,
  signature,
  saved,
  waitingRoutes,
  openItems,
  newQuote,
}: {
  base: BaseRow[];
  signature: string;
  /** Saved versions, newest first. */
  saved: SavedVersion[];
  waitingRoutes: number;
  openItems: number;
  newQuote: NewQuoteInfo;
}) {
  const router = useRouter();
  const [pageTab, setPageTab] = useState<PageTab>("current");
  const [listTab, setListTab] = useState<ListTab>("customer");
  const [standard, setStandard] = useState<number>(DEFAULT_MARKUP);
  /** null = the draft; otherwise the saved version being looked at. */
  const [viewing, setViewing] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);

  // Show the message saved just before switching back from ?with=new.
  useEffect(() => {
    try {
      const text = sessionStorage.getItem(NOTICE_KEY);
      if (text) {
        sessionStorage.removeItem(NOTICE_KEY);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off read of browser storage
        setNotice({ text, tone: "ok" });
      }
    } catch {}
  }, []);

  const latest = saved[0] ?? null;
  const draftVersion = (latest?.version ?? 0) + 1;
  const draftMarkup = markupFor(standard);
  const draftRows = priceRows(base, draftMarkup);
  const unchanged = latest !== null && base.length > 0 && sameList(latest.rows, draftRows);
  const open = viewing === null ? null : (saved.find((s) => s.version === viewing) ?? null);

  // Compare picks: "draft" or a saved version number. Defaults: latest saved vs draft.
  const [compareA, setCompareA] = useState<string>(latest ? String(latest.version) : "draft");
  const [compareB, setCompareB] = useState<string>("draft");

  function openVersion(version: number | null) {
    setViewing(version);
    setPageTab("current");
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: draftVersion,
          standard_markup: standard,
          signature,
          include_new: newQuote.included,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.ok) {
        const text = body.message ?? `Saved v${draftVersion}.`;
        setNotice({ text, tone: "ok" });
        setViewing(null);
        if (newQuote.included) {
          // The new quote is approved now, so the plain list includes it.
          try {
            sessionStorage.setItem(NOTICE_KEY, text);
          } catch {}
          router.replace("/pricing");
        } else {
          router.refresh();
        }
      } else {
        setNotice({ text: body.error ?? "Something went wrong saving the price list – try again.", tone: "warn" });
        if (res.status === 409) router.refresh();
      }
    } catch {
      setNotice({ text: "Couldn't reach the server – check your connection and try again.", tone: "warn" });
    } finally {
      setSaving(false);
    }
  }

  // Save always stores the draft; it is off while a saved version is on screen.
  const canSave = !saving && base.length > 0 && !unchanged && !(pageTab === "current" && viewing !== null);
  const shown = open
    ? { version: open.version, rows: open.rows, markup: open.markup, draft: false }
    : { version: draftVersion, rows: draftRows, markup: draftMarkup, draft: true };

  return (
    <>
      <div className="contents print:hidden">
        <PageHeader
          breadcrumb="Price lists"
          title="Price lists"
          actions={
            <>
              {unchanged && (
                <span className="text-[13px] text-muted">No changes since v{latest!.version}</span>
              )}
              <HeaderButton onClick={save} disabled={!canSave}>
                {saving ? "SAVING…" : "SAVE VERSION"}
              </HeaderButton>
              <HeaderButton primary onClick={() => window.print()}>
                EXPORT PDF
              </HeaderButton>
            </>
          }
        />
      </div>

      <div className="print:hidden">
        <PageTabs
          label="Views"
          active={pageTab}
          onChange={setPageTab}
          tabs={[
            { key: "current", label: "CURRENT LIST", icon: "all" },
            { key: "versions", label: `VERSIONS (${saved.length + 1})`, icon: "log" },
            { key: "compare", label: "COMPARE", icon: "table" },
          ]}
        />
      </div>

      {notice && (
        <div role="status" className="print:hidden">
          <DashedPill tone={notice.tone}>{notice.text}</DashedPill>
        </div>
      )}

      {pageTab === "current" && (
        <CurrentList
          shown={shown}
          draftVersion={draftVersion}
          saved={saved}
          listTab={listTab}
          setListTab={setListTab}
          standard={standard}
          setStandard={setStandard}
          openVersion={openVersion}
          waitingRoutes={waitingRoutes}
          openItems={openItems}
          newQuote={newQuote}
        />
      )}

      {pageTab === "versions" && (
        <Versions
          draftVersion={draftVersion}
          draftRows={draftRows}
          draftMarkup={draftMarkup}
          saved={saved}
          openVersion={openVersion}
        />
      )}

      {pageTab === "compare" && (
        <Compare
          draftVersion={draftVersion}
          draftRows={draftRows}
          saved={saved}
          a={compareA}
          b={compareB}
          setA={setCompareA}
          setB={setCompareB}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Current list (the draft, or a saved version opened from the panel)
// ---------------------------------------------------------------------------

function CurrentList({
  shown,
  draftVersion,
  saved,
  listTab,
  setListTab,
  standard,
  setStandard,
  openVersion,
  waitingRoutes,
  openItems,
  newQuote,
}: {
  shown: { version: number; rows: PriceRow[]; markup: Markup; draft: boolean };
  draftVersion: number;
  saved: SavedVersion[];
  listTab: ListTab;
  setListTab: (t: ListTab) => void;
  standard: number;
  setStandard: (n: number) => void;
  openVersion: (v: number | null) => void;
  waitingRoutes: number;
  openItems: number;
  newQuote: NewQuoteInfo;
}) {
  const t = totals(shown.rows);
  const empty = shown.rows.length === 0;
  const routeWord = (n: number) => (n === 1 ? "route" : "routes");

  const panel = (
    <>
      {shown.draft ? (
        <StatusBox label={`v${shown.version} Draft`} colour="#5B21B6" />
      ) : (
        <StatusBox label={`v${shown.version} Saved`} colour="#1E7A44" icon="tick" />
      )}
      {shown.draft ? (
        <PanelFact value={`${t.rows}/${t.rows + waitingRoutes}`} caption="Routes approved" />
      ) : (
        <PanelFact value={t.rows} caption={t.rows === 1 ? "Route" : "Routes"} />
      )}
      <PanelDivider />
      <div className="px-1.5 text-[13px] leading-[1.6]">
        <strong>Saved versions</strong>
        {saved.length === 0 && <div className="text-ink">None yet</div>}
        {saved.map((s) => (
          <div key={s.version}>
            {s.version === shown.version && !shown.draft ? (
              <span className="font-semibold">
                v{s.version} · {s.label}
              </span>
            ) : (
              <LinkButton onClick={() => openVersion(s.version)}>
                v{s.version} · {s.label}
              </LinkButton>
            )}
          </div>
        ))}
        {!shown.draft && (
          <div className="mt-2">
            <LinkButton onClick={() => openVersion(null)}>Back to v{draftVersion} draft</LinkButton>
          </div>
        )}
      </div>
    </>
  );

  return (
    <StatusCard colour={shown.draft ? "#CDBDF2" : "#BDEBD3"} panel={panel} hidePanelInPrint>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-medium">
          {COMPANY} – Price list v{shown.version}
        </h2>
        <span className="hidden text-[13px] text-muted print:inline">
          {shown.draft ? "Draft" : "Saved"} · {listTab === "customer" ? "Customer list" : "Internal list"} · Prices
          exclude VAT
        </span>
      </div>

      <div className="print:hidden">
        <CardTabs
          label="List type"
          active={listTab}
          onChange={setListTab}
          tabs={[
            { key: "customer", label: "CUSTOMER LIST" },
            { key: "internal", label: "INTERNAL LIST" },
          ]}
        />
      </div>

      {shown.draft && newQuote.included && (
        <div className="print:hidden">
          <DashedPill>
            <span>
              Includes the new {newQuote.waiting === 1 ? "quote" : "quotes"} – {newQuote.notes.join("; ")}. Saving
              v{shown.version} approves {newQuote.waiting === 1 ? "it" : "them"}.{" "}
              <Link href="/pricing" className="font-semibold">
                Leave it out
              </Link>
            </span>
          </DashedPill>
        </div>
      )}

      {shown.draft && !newQuote.included && newQuote.waiting > 0 && (
        <div className="print:hidden">
          <DashedPill tone="warn">
            <span>
              {newQuote.waiting} new {newQuote.waiting === 1 ? "quote is" : "quotes are"} waiting.{" "}
              <Link href="/pricing?with=new" className="font-semibold">
                Review {newQuote.waiting === 1 ? "it" : "them"}
              </Link>
            </span>
          </DashedPill>
        </div>
      )}

      {shown.draft && openItems > 0 && (
        <div className="print:hidden">
          <DashedPill tone="warn">
            <span>
              {openItems} {openItems === 1 ? "quote is" : "quotes are"} still in the review queue and{" "}
              {openItems === 1 ? "isn't" : "aren't"} in this list yet.{" "}
              <Link href="/review" className="font-semibold">
                Open review queue
              </Link>
            </span>
          </DashedPill>
        </div>
      )}

      {empty ? (
        <p className="m-0 text-[15px] text-slate">
          No approved quotes yet – process the inbox and clear the review queue first.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-[15px]">
            <span>
              Total supplier cost: <strong>{formatMoney(t.cost)}</strong> ({t.rows} {routeWord(t.rows)})
            </span>
            <span className="text-muted">•</span>
            <span>
              Total selling price: <strong>{formatMoney(t.sell)}</strong>
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <div
              className="rounded-pill bg-ready px-3.5 py-3 text-[15px]"
              style={{ flex: `${Math.max(t.margin, 0)} 1 160px` }}
            >
              <strong>{formatMoney(t.margin)} Margin</strong> ({Math.round(t.marginPct)}% of sales)
            </div>
            <div
              className="rounded-pill bg-need px-3.5 py-3 text-[15px]"
              style={{ flex: `${t.cost} 1 200px` }}
            >
              <strong>{formatMoney(t.cost)} Supplier cost</strong> ({t.rows} {t.rows === 1 ? "quote" : "quotes"})
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-start gap-7 print:hidden">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold tracking-[0.04em] text-slate">MARKUP ON STANDARD JOBS</span>
          <div className="flex gap-2">
            {MARKUP_CHOICES.map((m) => {
              const on = shown.draft ? m === standard : m === shown.markup.standard;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  disabled={!shown.draft}
                  onClick={() => setStandard(m)}
                  className={`min-h-11 min-w-16 rounded-btn border text-sm font-semibold ${
                    on ? "border-primary bg-primary text-white" : "border-line-strong bg-white text-ink"
                  } ${shown.draft ? "cursor-pointer" : "cursor-default opacity-70"}`}
                >
                  {m}%
                </button>
              );
            })}
          </div>
          {!shown.draft && (
            <span className="text-xs text-muted">Saved versions keep the markup they were saved with.</span>
          )}
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <span className="text-xs font-semibold tracking-[0.04em] text-slate">CATEGORY EXTRAS</span>
          <div className="grid grid-cols-2 gap-x-7 gap-y-1.5">
            <span className="text-slate">Out-of-hours</span>
            <span>+{CATEGORY_EXTRAS.out_of_hours} points</span>
            <span className="text-slate">Specialist</span>
            <span>+{CATEGORY_EXTRAS.specialist} points</span>
          </div>
        </div>
      </div>

      {!empty && (listTab === "customer" ? <CustomerTable rows={shown.rows} /> : <InternalTable rows={shown.rows} />)}
    </StatusCard>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] text-primary underline hover:text-primary-hover"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tables (real <table>s so the header row repeats on every printed page)
// ---------------------------------------------------------------------------

const tableBox = "overflow-x-auto rounded-btn border border-line-soft print:overflow-visible";
const tableClass = "w-full border-collapse text-left print:min-w-0";
const th = "bg-well px-3.5 py-2.5 text-xs font-semibold tracking-[0.04em] text-slate align-bottom";
const td = "border-t border-line-soft px-3.5 py-2.5 text-sm align-top";

function CustomerTable({ rows }: { rows: PriceRow[] }) {
  return (
    <div className={tableBox}>
      <table className={`${tableClass} min-w-[460px]`}>
        <colgroup>
          <col style={{ width: "48%" }} />
          <col style={{ width: "30%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className={th}>ROUTE</th>
            <th className={th}>SERVICE</th>
            <th className={th}>PRICE (EX VAT)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="break-inside-avoid">
              <td className={td}>{r.route}</td>
              <td className={`${td} text-slate`}>{serviceLabel(r)}</td>
              <td className={`${td} font-semibold tabular-nums`}>{priceLabel(r.sell, r.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnitNote({ unit }: { unit: string }) {
  return unit === "per job" ? null : <div className="text-xs font-normal text-muted">{unit}</div>;
}

function InternalTable({ rows }: { rows: PriceRow[] }) {
  return (
    <div className={tableBox}>
      <table className={`${tableClass} min-w-[680px] tabular-nums`}>
        <colgroup>
          <col style={{ width: "32%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className={th}>ROUTE</th>
            <th className={th}>SUPPLIER</th>
            <th className={th}>COST</th>
            <th className={th}>MARKUP</th>
            <th className={th}>SELL</th>
            <th className={th}>MARGIN</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="break-inside-avoid">
              <td className={td}>
                {r.route}
                <div className="text-xs text-muted">{serviceLabel(r)}</div>
              </td>
              <td className={`${td} text-slate`}>{r.supplier}</td>
              <td className={td}>
                {formatMoney(r.cost)}
                <UnitNote unit={r.unit} />
              </td>
              <td className={td}>{r.markup_pct}%</td>
              <td className={td}>
                {formatMoney(r.sell)}
                <UnitNote unit={r.unit} />
              </td>
              <td className={`${td} text-[#166534]`}>{formatMoney(r.margin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

function Versions({
  draftVersion,
  draftRows,
  draftMarkup,
  saved,
  openVersion,
}: {
  draftVersion: number;
  draftRows: PriceRow[];
  draftMarkup: Markup;
  saved: SavedVersion[];
  openVersion: (v: number | null) => void;
}) {
  const items = [
    {
      version: draftVersion,
      draft: true,
      label: "Current list – not saved yet",
      created: "Built from approved quotes",
      markup: draftMarkup,
      rows: draftRows,
    },
    ...saved.map((s) => ({ ...s, draft: false })),
  ];
  return (
    <section className="flex flex-col gap-3">
      {items.map((v) => {
        const t = totals(v.rows);
        return (
          <article
            key={v.version}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-line bg-white px-[22px] py-4 shadow-card"
          >
            <span
              className="rounded-btn px-2.5 py-1 text-[13px] font-semibold"
              style={
                v.draft
                  ? { background: "#CDBDF2", color: "#5B21B6" }
                  : { background: "#BDEBD3", color: "#1E7A44" }
              }
            >
              v{v.version} {v.draft ? "Draft" : "Saved"}
            </span>
            <div className="flex min-w-[180px] flex-[2_1_200px] flex-col">
              <span className="text-[15px] font-medium">{v.label}</span>
              <span className="text-[13px] text-muted">{v.created}</span>
            </div>
            <dl className="m-0 grid flex-[3_1_320px] grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-4">
              <Fact label="Routes" value={String(t.rows)} />
              <Fact label="Supplier cost" value={formatMoney(t.cost)} />
              <Fact label="Selling price" value={formatMoney(t.sell)} />
              <Fact label="Markup" value={`${v.markup.standard}% Standard`} />
            </dl>
            <button
              type="button"
              onClick={() => openVersion(v.draft ? null : v.version)}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-btn border border-line-strong bg-white px-4 text-[13px] font-semibold tracking-[0.03em] text-ink hover:bg-well"
            >
              OPEN
            </button>
          </article>
        );
      })}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

function Compare({
  draftVersion,
  draftRows,
  saved,
  a,
  b,
  setA,
  setB,
}: {
  draftVersion: number;
  draftRows: PriceRow[];
  saved: SavedVersion[];
  a: string;
  b: string;
  setA: (v: string) => void;
  setB: (v: string) => void;
}) {
  const options = [
    { value: "draft", label: `v${draftVersion} (draft)`, rows: draftRows },
    ...saved.map((s) => ({ value: String(s.version), label: `v${s.version} · ${s.label}`, rows: s.rows })),
  ];
  const pick = (value: string) => options.find((o) => o.value === value) ?? options[0];
  const before = pick(a);
  const after = pick(b);
  const diff = compareVersions(before.rows, after.rows);
  const same = diff.added.length + diff.removed.length + diff.changed.length === 0;

  const select = (id: string, value: string, set: (v: string) => void, label: string) => (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-xs font-semibold tracking-[0.04em] text-slate">
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="min-h-11 rounded-btn border border-line-strong bg-white px-3 text-sm font-normal tracking-normal text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <article className="flex flex-col gap-3.5 rounded-card border border-line bg-white px-[22px] py-[18px] shadow-card">
      <div className="flex flex-wrap items-end gap-4">
        {select("compare-a", a, setA, "FROM")}
        {select("compare-b", b, setB, "TO")}
      </div>
      <h2 className="m-0 text-lg font-medium">
        {before.label.split(" ·")[0]} → {after.label.split(" ·")[0]}
      </h2>
      {same ? (
        <p className="m-0 text-[15px] text-slate">These two versions are the same.</p>
      ) : (
        <>
          <p className="m-0 text-[15px]">
            <strong>{diff.changed.length}</strong> changed · <strong>{diff.added.length}</strong> added ·{" "}
            <strong>{diff.removed.length}</strong> removed
          </p>
          {diff.changed.length > 0 && <ChangedTable changes={diff.changed} />}
          {diff.added.length > 0 && <RowsTable title={`Added (${diff.added.length})`} rows={diff.added} />}
          {diff.removed.length > 0 && <RowsTable title={`Removed (${diff.removed.length})`} rows={diff.removed} />}
        </>
      )}
    </article>
  );
}

function ChangedTable({ changes }: { changes: { before: PriceRow; after: PriceRow }[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[15px] font-semibold">Changed ({changes.length})</h3>
      <div className={tableBox}>
        <table className={`${tableClass} min-w-[760px] tabular-nums`}>
          <thead>
            <tr>
              <th className={th}>ROUTE</th>
              <th className={th}>SUPPLIER</th>
              <th className={th}>COST</th>
              <th className={th}>SELL</th>
              <th className={th}>CHANGE</th>
            </tr>
          </thead>
          <tbody>
            {changes.map(({ before, after }, i) => {
              const delta = after.sell - before.sell;
              const pct = before.sell === 0 ? 0 : (delta / before.sell) * 100;
              return (
                <tr key={i} className="break-inside-avoid">
                  <td className={td}>
                    {after.route}
                    <div className="text-xs text-muted">{serviceLabel(after)}</div>
                  </td>
                  <td className={`${td} text-slate`}>
                    {before.supplier === after.supplier ? after.supplier : `${before.supplier} → ${after.supplier}`}
                  </td>
                  <td className={td}>
                    {formatMoney(before.cost)} → {formatMoney(after.cost)}
                    <UnitNote unit={after.unit} />
                  </td>
                  <td className={td}>
                    {formatMoney(before.sell)} → <strong>{formatMoney(after.sell)}</strong>
                  </td>
                  <td className={`${td} ${delta < 0 ? "text-[#166534]" : delta > 0 ? "text-on-salmon" : ""}`}>
                    {formatChange(Math.round(delta * 100) / 100)} ({pct > 0 ? "+" : pct < 0 ? "−" : ""}
                    {Math.abs(pct).toFixed(1)}%)
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RowsTable({ title, rows }: { title: string; rows: PriceRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
      <div className={tableBox}>
        <table className={`${tableClass} min-w-[600px] tabular-nums`}>
          <thead>
            <tr>
              <th className={th}>ROUTE</th>
              <th className={th}>SUPPLIER</th>
              <th className={th}>COST</th>
              <th className={th}>SELL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="break-inside-avoid">
                <td className={td}>
                  {r.route}
                  <div className="text-xs text-muted">{serviceLabel(r)}</div>
                </td>
                <td className={`${td} text-slate`}>{r.supplier}</td>
                <td className={td}>{priceLabel(r.cost, r.unit)}</td>
                <td className={td}>{priceLabel(r.sell, r.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
