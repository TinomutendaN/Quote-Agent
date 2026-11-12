import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { UNKNOWN_PANEL } from "@/components/colours";
import {
  listHistoryLines,
  listRules,
  listSourceFiles,
  listSuppliers,
  type SourceFile,
} from "@/lib/db";
import { readEmailSubject } from "@/lib/samples";
import { InboxView, type InboxFile, type InboxGroup } from "./InboxView";

export default function InboxPage() {
  return (
    <>
      {/* "Process inbox" and "Add quotes" are added in Step 6. */}
      <PageHeader breadcrumb="Inbox" title="Inbox" />
      <Suspense fallback={<p className="m-0 text-sm text-slate">Loading the inbox…</p>}>
        <InboxData />
      </Suspense>
    </>
  );
}

async function InboxData() {
  const [files, suppliers, history, rules] = await Promise.all([
    listSourceFiles(),
    listSuppliers(),
    listHistoryLines(),
    listRules(),
  ]);

  // The held-back file (16) only appears after the inbox has been processed.
  const inboxFiles = files.filter((f) => !f.is_held_back);
  const tiles = await Promise.all(inboxFiles.map(toTile));

  // Group by supplier, ordered by each supplier's first file.
  const groups = new Map<string, InboxGroup>();
  inboxFiles.forEach((f, i) => {
    const key = f.supplier_id === null ? "unknown" : String(f.supplier_id);
    let group = groups.get(key);
    if (!group) {
      const supplier = suppliers.find((s) => s.id === f.supplier_id);
      group = {
        key,
        name: supplier?.name ?? "Unknown sender",
        colour: supplier?.colour ?? UNKNOWN_PANEL,
        isUnknown: !supplier,
        files: [],
        history: history
          .filter((h) => h.supplier_id === f.supplier_id)
          .map((h) => ({
            id: h.id,
            route: h.route,
            category: h.category,
            price: Number(h.price),
            day: h.quote_day,
          })),
      };
      groups.set(key, group);
    }
    group.files.push(tiles[i]);
  });

  return (
    <InboxView
      groups={[...groups.values()]}
      rules={rules.map((r) => ({ number: r.number, text: r.text }))}
    />
  );
}

const typeLabels: Record<SourceFile["type"], string> = {
  email: "Email",
  pdf: "PDF",
  scan: "Scanned PDF",
  spreadsheet: "Spreadsheet",
};

async function toTile(f: SourceFile): Promise<InboxFile> {
  const subject = f.type === "email" ? await readEmailSubject(f.file_path) : null;
  // Sample files start with their number ("06_..."); the design shows the name without it.
  const name = f.is_upload ? f.file_name : f.file_name.replace(/^\d+_/, "");
  const ext = f.file_name.split(".").pop()?.toLowerCase();
  const typeLabel =
    f.type === "spreadsheet"
      ? `Spreadsheet · ${ext === "csv" ? "CSV" : "Excel"}`
      : typeLabels[f.type];
  const sender = f.sender_name ?? "Unknown sender";
  return {
    id: f.id,
    type: f.type,
    title: subject ?? name,
    typeLabel,
    time: f.received_time,
    day: f.received_day,
    sender,
    initials: f.sender_name ? initialsOf(f.sender_name) : "?",
    status: f.status,
  };
}

/** "Dan Price" → "DP", "R. Moorhouse" → "RM", "M6 Express" → "ME". */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
