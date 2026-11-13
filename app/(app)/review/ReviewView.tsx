"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { CardTitle, DashedPill, StripCard } from "@/components/Cards";
import { Icon, type IconName } from "@/components/Icon";
import { HeaderLink } from "@/components/PageHeader";
import { CardTabs, PageTabs } from "@/components/Tabs";
import type { Category, ReasonType } from "@/lib/db";
import { REASON_TABS, type ReasonTab, SERVICES, formatPrice } from "@/lib/review";

export type ReviewCard = {
  id: number;
  reason: ReasonType;
  strip: string;
  title: string;
  why: string;
  supplier: string;
  file: string;
  route: string;
  source: string;
  suggestion: string;
  excerpt: string;
  originalHref: string | null;
  usualPrice: number | null;
  line: { route: string; category: Category | null; price: number; unit: string | null } | null;
  /** Past prices for this route and service. */
  history: { supplier: string; price: number; day: string }[];
  /** Duplicate: every quote for the same job, oldest first. */
  sameJob: { price: number; time: string; flagged: boolean; file: string }[];
  /** Unknown sender: each route in the file. */
  routes: { route: string; category: Category | null; price: number; usual: number | null }[];
  /** Unclear: the price and unit Approve will save. */
  fix: { price: number; unit: string } | null;
};

type Supplier = { id: number; name: string };
type Action = "approve" | "edit" | "reject";
type Notice = { text: string; tone: "ok" | "warn" };

export function ReviewView({ cards, suppliers }: { cards: ReviewCard[]; suppliers: Supplier[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<ReasonTab>("all");
  const [notice, setNotice] = useState<Notice | null>(null);

  const visible = cards.filter((c) => tab === "all" || c.reason === tab);

  /** Sends one action; returns an error message to show on the card, or null. */
  async function send(id: number, action: Action, fields: Record<string, unknown> = {}) {
    let res: Response;
    try {
      res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: id, action, ...fields }),
      });
    } catch {
      return "Couldn't reach the server – check your connection and try again.";
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (res.ok) {
      setNotice({ text: body.message ?? "Saved.", tone: "ok" });
      router.refresh();
      return null;
    }
    if (res.status === 409) {
      // Someone else resolved it: drop it from the list.
      setNotice({ text: body.error ?? "Already handled.", tone: "warn" });
      router.refresh();
      return null;
    }
    return body.error ?? "Something went wrong saving that – try again.";
  }

  return (
    <>
      <PageTabs
        label="Reasons"
        active={tab}
        onChange={setTab}
        tabs={REASON_TABS.map((t) => ({
          ...t,
          label: t.key === "all" ? `${t.label} (${cards.length})` : t.label,
        }))}
      />
      {cards.length > 0 && (
        <p className="m-0 text-sm text-slate">
          The agent stopped on these instead of guessing. Nothing reaches a price list until you
          approve it.
        </p>
      )}
      {notice && (
        <p
          role="status"
          className={`m-0 self-start rounded-btn border-[1.5px] border-dashed px-3 py-[7px] text-[13px] font-medium ${
            notice.tone === "ok"
              ? "border-ok-line bg-ok-bg text-on-mint"
              : "border-warn-line bg-warn-bg text-warn-text"
          }`}
        >
          {notice.text}
        </p>
      )}
      {cards.length === 0 ? (
        <EmptyQueue />
      ) : visible.length === 0 ? (
        <p className="m-0 text-sm text-slate">Nothing in this group.</p>
      ) : (
        visible.map((c) => <ReviewItemCard key={c.id} card={c} suppliers={suppliers} send={send} />)
      )}
    </>
  );
}

function EmptyQueue() {
  return (
    <StripCard colour="#BDEBD3">
      <div className="flex items-center gap-2.5 text-on-mint">
        <Icon name="tick" size={22} strokeWidth={1.8} />
        <h2 className="m-0 text-lg font-medium text-ink">Nothing left to review</h2>
      </div>
      <p className="m-0 text-sm text-slate">
        Every quote the agent stopped on has been handled. The approved prices are ready for your
        price list.
      </p>
      <div>
        <HeaderLink href="/pricing" primary>
          CONTINUE TO PRICING
        </HeaderLink>
      </div>
    </StripCard>
  );
}

type CardTab = "general" | "original" | "history";
type Mode = "buttons" | "edit" | "pick";

function ReviewItemCard({
  card,
  suppliers,
  send,
}: {
  card: ReviewCard;
  suppliers: Supplier[];
  send: (id: number, action: Action, fields?: Record<string, unknown>) => Promise<string | null>;
}) {
  const [tab, setTab] = useState<CardTab>("general");
  const [mode, setMode] = useState<Mode>("buttons");
  // Unknown sender: Approve and Edit both open the supplier picker.
  const [pickVia, setPickVia] = useState<"approve" | "edit">("approve");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action, fields?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const err = await send(card.id, action, fields);
    setBusy(false);
    if (err) setError(err);
  }

  const isUnknown = card.reason === "unknown_sender";

  return (
    <StripCard colour={card.strip}>
      <CardTitle>{card.title}</CardTitle>
      <CardTabs
        label={`${card.title} views`}
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "general", label: "GENERAL" },
          { key: "original", label: "ORIGINAL TEXT" },
          { key: "history", label: "PRICE HISTORY" },
        ]}
      />

      {tab === "general" && (
        <>
          <DashedPill tone="warn">{card.why}</DashedPill>
          <div className="flex flex-wrap gap-x-7 gap-y-2.5 text-sm">
            <Detail icon="person">{card.supplier}</Detail>
            <Detail icon="file">{card.file}</Detail>
            <Detail icon="pin">{card.route}</Detail>
          </div>
          <div className="rounded-btn bg-well px-3 py-2.5 text-[13px] leading-[1.6] [overflow-wrap:anywhere] text-slate">
            {card.source}
          </div>
        </>
      )}
      {tab === "original" && <OriginalText card={card} />}
      {tab === "history" && <PriceHistory card={card} />}

      {mode === "buttons" && (
        <div className="flex flex-wrap items-end justify-between gap-3.5">
          <div className="flex flex-[1_1_280px] flex-col gap-1">
            <span className="text-xs font-semibold tracking-[0.04em] text-slate">AGENT SUGGESTS</span>
            <span className="text-[15px]">{card.suggestion}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              primary
              disabled={busy}
              onClick={() => {
                if (!isUnknown) return run("approve");
                setPickVia("approve");
                setMode("pick");
              }}
            >
              {busy ? "SAVING…" : "APPROVE"}
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => {
                setPickVia("edit");
                setMode(isUnknown ? "pick" : "edit");
              }}
            >
              EDIT
            </ActionButton>
            <ActionButton disabled={busy} onClick={() => run("reject")}>
              REJECT
            </ActionButton>
          </div>
        </div>
      )}
      {mode === "pick" && (
        <SupplierPicker
          suppliers={suppliers}
          busy={busy}
          onCancel={() => setMode("buttons")}
          onSave={(supplierId) => run(pickVia, { supplier_id: supplierId })}
        />
      )}
      {mode === "edit" && card.reason === "duplicate" && (
        <DuplicateForm card={card} busy={busy} onCancel={() => setMode("buttons")} onSave={(f) => run("edit", f)} />
      )}
      {mode === "edit" && (card.reason === "price_wrong" || card.reason === "unclear") && (
        <LineForm card={card} busy={busy} onCancel={() => setMode("buttons")} onSave={(f) => run("edit", f)} />
      )}
      {error && (
        <p role="alert" className="m-0 text-sm font-medium text-on-salmon">
          {error}
        </p>
      )}
    </StripCard>
  );
}

function Detail({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
      <Icon name={icon} size={18} strokeWidth={1.6} />
      {children}
    </span>
  );
}

function ActionButton({
  children,
  primary = false,
  disabled,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 cursor-pointer rounded-btn px-4 text-[13px] font-semibold tracking-[0.03em] disabled:cursor-wait disabled:opacity-70 ${
        primary
          ? "border-0 bg-primary text-white hover:bg-primary-hover"
          : "border border-line-strong bg-white text-ink hover:bg-well"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card tabs
// ---------------------------------------------------------------------------

function OriginalText({ card }: { card: ReviewCard }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold tracking-[0.04em] text-slate">WHAT THE FILE SAYS</span>
      <pre className="m-0 max-h-72 overflow-auto rounded-btn bg-well px-3 py-2.5 font-sans text-[13px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere] text-slate">
        {card.excerpt || "No original text was stored."}
      </pre>
      {card.originalHref ? (
        <a href={card.originalHref} target="_blank" rel="noopener noreferrer" className="self-start text-[13px] font-semibold">
          Open the original file
        </a>
      ) : (
        <span className="text-[13px] text-muted">Uploaded files aren&apos;t kept, so there is no original to open.</span>
      )}
    </div>
  );
}

const tableBox = "overflow-x-auto rounded-btn border border-line-soft";
const headRow = "bg-well text-xs font-semibold tracking-[0.04em] text-slate";

function PriceHistory({ card }: { card: ReviewCard }) {
  if (card.reason === "unknown_sender") {
    const cols = "grid min-w-[460px] grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_90px_110px] gap-2.5 px-3.5 py-2.5";
    return (
      <div className="flex flex-col gap-2.5">
        <p className="m-0 text-[13px] text-slate">The prices in this file, next to the usual price for each route.</p>
        <div className={tableBox}>
          <div className={`${cols} ${headRow}`}>
            <span>ROUTE</span>
            <span>SERVICE</span>
            <span>PRICE</span>
            <span>USUAL PRICE</span>
          </div>
          {card.routes.map((r, i) => (
            <div key={i} className={`${cols} border-t border-line-soft text-sm tabular-nums`}>
              <span>{r.route}</span>
              <span className="text-slate">{r.category ?? "Not sorted"}</span>
              <span className="font-semibold">{formatPrice(r.price)}</span>
              <span className="text-slate">{r.usual === null ? "No past prices" : formatPrice(r.usual)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const service = card.line?.category ?? "this service";
  const cols = "grid min-w-[400px] grid-cols-[minmax(0,1.4fr)_100px_minmax(0,1fr)] gap-2.5 px-3.5 py-2.5";
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-sm">
        Usual price for {card.line?.route} ({service}):{" "}
        <strong>{card.usualPrice === null ? "no past prices" : formatPrice(card.usualPrice)}</strong>
      </p>
      {card.sameJob.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-[0.04em] text-slate">QUOTES FOR THIS JOB IN THE INBOX</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {card.sameJob.map((s, i) => (
              <li key={i}>
                <strong>{formatPrice(s.price)}</strong> – received {s.time}
                {s.flagged ? " (the later quote)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {card.history.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">No past quotes on record for this route and service.</p>
      ) : (
        <div className={tableBox}>
          <div className={`${cols} ${headRow}`}>
            <span>SUPPLIER</span>
            <span>PRICE</span>
            <span>QUOTED</span>
          </div>
          {card.history.map((h, i) => (
            <div key={i} className={`${cols} border-t border-line-soft text-sm tabular-nums`}>
              <span>{h.supplier}</span>
              <span className="font-semibold">{formatPrice(h.price)}</span>
              <span className="text-slate">{h.day}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline forms
// ---------------------------------------------------------------------------

const inputClass =
  "box-border min-h-11 w-full rounded-btn border border-line-strong bg-white px-3 text-sm text-ink";

function Field({ label, children, grow = "1_1_160px" }: { label: string; children: ReactNode; grow?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1" style={{ flex: grow.replace(/_/g, " ") }}>
      <span className="text-xs font-semibold tracking-[0.04em] text-slate">{label}</span>
      {children}
    </label>
  );
}

function FormShell({
  onSubmit,
  busy,
  onCancel,
  children,
}: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-btn border border-line-soft p-3.5">
      {children}
      <div className="flex flex-wrap gap-2">
        <ActionButton primary type="submit" disabled={busy}>
          {busy ? "SAVING…" : "SAVE"}
        </ActionButton>
        <ActionButton disabled={busy} onClick={onCancel}>
          CANCEL
        </ActionButton>
      </div>
    </form>
  );
}

function LineForm({
  card,
  busy,
  onCancel,
  onSave,
}: {
  card: ReviewCard;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: Record<string, unknown>) => void;
}) {
  const line = card.line!;
  const [price, setPrice] = useState(String(card.fix?.price ?? line.price));
  const [unit, setUnit] = useState(card.fix?.unit ?? line.unit ?? "");
  const [route, setRoute] = useState(line.route);
  const [category, setCategory] = useState<string>(line.category ?? "Standard");

  return (
    <FormShell
      busy={busy}
      onCancel={onCancel}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          price: Number(price),
          unit: card.reason === "unclear" ? unit : undefined,
          route,
          category,
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <Field label="PRICE (£, EX VAT)" grow="1_1_120px">
          <input
            className={inputClass}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        {card.reason === "unclear" && (
          <Field label="UNIT" grow="1_1_140px">
            <input className={inputClass} required maxLength={60} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        )}
        <Field label="ROUTE" grow="2_1_220px">
          <input className={inputClass} required minLength={3} maxLength={120} value={route} onChange={(e) => setRoute(e.target.value)} />
        </Field>
        <Field label="SERVICE" grow="1_1_150px">
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {SERVICES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
    </FormShell>
  );
}

function DuplicateForm({
  card,
  busy,
  onCancel,
  onSave,
}: {
  card: ReviewCard;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: Record<string, unknown>) => void;
}) {
  const earlier = card.sameJob[0];
  const later = card.sameJob[card.sameJob.length - 1];
  const [keep, setKeep] = useState<"later" | "earlier">("later");
  const [price, setPrice] = useState("");

  return (
    <FormShell
      busy={busy}
      onCancel={onCancel}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ keep, price: price ? Number(price) : null });
      }}
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-xs font-semibold tracking-[0.04em] text-slate">WHICH QUOTE TO KEEP</legend>
        {later && (
          <label className="flex min-h-11 items-center gap-2.5 text-sm">
            <input type="radio" name={`keep-${card.id}`} checked={keep === "later"} onChange={() => setKeep("later")} />
            Keep the later {formatPrice(later.price)} (received {later.time})
          </label>
        )}
        {earlier && earlier !== later && (
          <label className="flex min-h-11 items-center gap-2.5 text-sm">
            <input type="radio" name={`keep-${card.id}`} checked={keep === "earlier"} onChange={() => setKeep("earlier")} />
            Keep the earlier {formatPrice(earlier.price)} (received {earlier.time})
          </label>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Field label="NEW PRICE FOR THE KEPT QUOTE (OPTIONAL)" grow="0_1_280px">
          <input
            className={inputClass}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="Leave empty to keep its price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
      </div>
    </FormShell>
  );
}

function SupplierPicker({
  suppliers,
  busy,
  onCancel,
  onSave,
}: {
  suppliers: Supplier[];
  busy: boolean;
  onCancel: () => void;
  onSave: (supplierId: number) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  return (
    <FormShell
      busy={busy}
      onCancel={onCancel}
      onSubmit={(e) => {
        e.preventDefault();
        if (supplierId) onSave(Number(supplierId));
      }}
    >
      <div className="flex flex-wrap gap-3">
        <Field label="WHO SENT THIS FILE?" grow="0_1_320px">
          <select className={inputClass} required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <span className="text-[13px] text-slate">
        The supplier is set on the file and all its prices, and the prices are approved.
      </span>
    </FormShell>
  );
}
