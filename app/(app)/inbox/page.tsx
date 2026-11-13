import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SavedRunNote } from "@/components/SavedRunNote";
import { UNKNOWN_PANEL } from "@/components/colours";
import { displayFileName } from "@/lib/fileNames";
import {
  listHistoryLines,
  listRules,
  listSourceFiles,
  listSuppliers,
  type SourceFile,
  type SourceFileWithCount,
} from "@/lib/db";
import { readEmailSubject } from "@/lib/samples";
import { AddQuotesButton, InboxNotice, ProcessInboxButton } from "./InboxActions";
import { InboxView, type InboxFile, type InboxGroup } from "./InboxView";

export default function InboxPage() {
  return (
    <>
      <PageHeader
        breadcrumb="Inbox"
        title="Inbox"
        actions={
          <>
            <AddQuotesButton />
            <ProcessInboxButton />
          </>
        }
      />
      <InboxNotice />
      <Suspense fallback={null}>
        <SavedRunNote />
      </Suspense>
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

  // The held-back file (16) only appears once the agent has processed it.
  const inboxFiles = files.filter(
    (f) => !f.is_held_back || f.status === "done" || f.status === "needs_review",
  );
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

async function toTile(f: SourceFileWithCount): Promise<InboxFile> {
  const subject = f.type === "email" ? await readEmailSubject(f.file_path) : null;
  const name = displayFileName(f);
  const ext = f.file_name.split(".").pop()?.toLowerCase();
  const typeLabel =
    f.type === "spreadsheet"
      ? `Spreadsheet · ${ext === "csv" ? "CSV" : "Excel"}`
      : f.type === "scan" && ["png", "jpg", "jpeg"].includes(ext ?? "")
        ? "Photo"
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
    linesFound: f.lines_found,
    needsYou: f.open_reviews > 0,
    // Uploads aren't kept, so they have nothing to open.
    href: f.is_upload || !f.file_path ? null : f.file_path,
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
