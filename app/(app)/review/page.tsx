import { Suspense } from "react";
import { HeaderLink, PageHeader } from "@/components/PageHeader";
import {
  type OpenReviewItem,
  fileLines,
  listOpenReviewItems,
  listSuppliers,
  pastPricesForRoute,
  sameJobLines,
} from "@/lib/db";
import { displayFileName } from "@/lib/fileNames";
import { REASON_STRIP, formatPrice, jobName, routeDetail, unclearFix } from "@/lib/review";
import { readEmailSubject } from "@/lib/samples";
import { ReviewView, type ReviewCard } from "./ReviewView";

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        breadcrumb="Review queue"
        title="Review queue"
        actions={
          <HeaderLink href="/pricing" primary>
            CONTINUE TO PRICING
          </HeaderLink>
        }
      />
      <Suspense fallback={<p className="m-0 text-sm text-slate">Loading the review queue…</p>}>
        <ReviewData />
      </Suspense>
    </>
  );
}

async function ReviewData() {
  const [items, suppliers] = await Promise.all([listOpenReviewItems(), listSuppliers()]);
  const cards = await Promise.all(items.map(toCard));
  return <ReviewView cards={cards} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} />;
}

const FILE_WORD: Record<OpenReviewItem["file_type"], string> = {
  email: "Email",
  pdf: "PDF",
  scan: "Scan",
  spreadsheet: "Spreadsheet",
};

/** First line of the stored excerpt, quoted and clipped for the General tab. */
function shortQuote(excerpt: string | null): string {
  const first = (excerpt ?? "").split("\n").find((l) => l.trim()) ?? "";
  const clipped = first.trim().replace(/\s+/g, " ");
  if (!clipped) return "No original text was stored.";
  return `“${clipped.length > 160 ? clipped.slice(0, 157) + "…" : clipped}”`;
}

async function toCard(item: OpenReviewItem): Promise<ReviewCard> {
  const name = displayFileName(item);
  const subject = item.file_type === "email" ? await readEmailSubject(item.file_path) : null;
  const supplier = item.supplier_name ?? "Unknown sender";
  const base = {
    id: item.id,
    reason: item.reason_type,
    strip: REASON_STRIP[item.reason_type],
    why: item.reason_text,
    supplier: item.supplier_name ?? "Not found",
    file: subject ?? name,
    suggestion: item.suggestion ?? "No suggestion – decide from the original text.",
    excerpt: item.original_excerpt ?? "",
    originalHref: item.is_upload || !item.file_path ? null : item.file_path,
    usualPrice: item.usual_price === null ? null : Number(item.usual_price),
    line: item.line
      ? {
          route: item.line.route,
          category: item.line.category,
          price: Number(item.line.price),
          unit: item.line.unit_note,
        }
      : null,
  };

  if (item.reason_type === "unknown_sender") {
    const lines = await fileLines(item.source_file_id);
    const routes = await Promise.all(
      lines.map(async (l) => {
        const past = l.category ? await pastPricesForRoute(l.route, l.category) : [];
        const usual = past.length ? past.reduce((s, p) => s + Number(p.price), 0) / past.length : null;
        return { route: l.route, category: l.category, price: Number(l.price), usual };
      }),
    );
    const firstLine = (item.original_excerpt ?? "").split("\n")[0]?.trim() ?? "";
    return {
      ...base,
      title: `Unknown sender – ${lines.length} routes in ${name}`,
      route: `${lines.length} routes`,
      source:
        item.file_type === "spreadsheet" && firstLine
          ? `Columns: ${firstLine.split(",").map((c) => c.trim()).join(", ")}. ${lines.length} prices, no company name.`
          : shortQuote(item.original_excerpt),
      history: [],
      sameJob: [],
      routes,
      fix: null,
    };
  }

  const line = item.line!;
  const history = line.category ? await pastPricesForRoute(line.route, line.category) : [];
  const historyRows = history.map((h) => ({ supplier: h.supplier, price: Number(h.price), day: h.quote_day }));

  if (item.reason_type === "duplicate") {
    const same = await sameJobLines(line.id);
    const sameJob = same.map((s) => ({
      price: Number(s.price),
      time: s.received_time,
      flagged: s.is_flagged,
      file: s.file_name,
    }));
    const allEmail = same.length > 0 && item.file_type === "email";
    return {
      ...base,
      title: `${supplier} – ${jobName(line)}`,
      file: `${same.length} ${allEmail ? "emails" : "files"}`,
      route: routeDetail(line),
      source: same
        .map((s) => `${FILE_WORD[item.file_type]} at ${s.received_time} says ${formatPrice(s.price)}`)
        .join(" · "),
      history: historyRows,
      sameJob,
      routes: [],
      fix: null,
    };
  }

  return {
    ...base,
    title: `${supplier} – ${line.route} ${formatPrice(line.price)}`,
    route: routeDetail(line),
    source: shortQuote(item.original_excerpt),
    history: historyRows,
    sameJob: [],
    routes: [],
    fix: item.reason_type === "unclear" ? unclearFix(item.suggestion, line) : null,
  };
}
