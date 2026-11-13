"use client";

import { useState } from "react";
import {
  CardTitle,
  DashedPill,
  InitialsCircle,
  PanelDivider,
  PanelFact,
  PillTile,
  StatusBox,
  StatusCard,
} from "@/components/Cards";
import { Icon, type IconName } from "@/components/Icon";
import { CardTabs, PageTabs } from "@/components/Tabs";
import { textOnPastel } from "@/components/colours";
import type { Category, SourceFileStatus, SourceFileType } from "@/lib/db";

export type InboxFile = {
  id: number;
  type: SourceFileType;
  title: string;
  typeLabel: string;
  time: string;
  day: string;
  sender: string;
  initials: string;
  status: SourceFileStatus;
  linesFound: number;
  /** The original sample file, or null for uploads (not kept). */
  href: string | null;
};

export type InboxGroup = {
  key: string;
  name: string;
  colour: string;
  isUnknown: boolean;
  files: InboxFile[];
  history: { id: number; route: string; category: Category; price: number; day: string }[];
};

type Rule = { number: number; text: string };

type TypeTab = "all" | "email" | "pdf" | "spreadsheet";

// The PDFs tab includes scans.
const tabMatches: Record<TypeTab, (t: SourceFileType) => boolean> = {
  all: () => true,
  email: (t) => t === "email",
  pdf: (t) => t === "pdf" || t === "scan",
  spreadsheet: (t) => t === "spreadsheet",
};

const fileIcons: Record<SourceFileType, IconName> = {
  email: "mail",
  pdf: "file",
  scan: "file",
  spreadsheet: "sheet",
};

function fileNote(f: InboxFile): string {
  if (f.status === "waiting") return "Not processed yet";
  if (f.status === "working") return "Being read";
  const found = `${f.linesFound} ${f.linesFound === 1 ? "price" : "prices"} found`;
  return f.status === "needs_review" ? `${found} · needs you` : found;
}

export function InboxView({ groups, rules }: { groups: InboxGroup[]; rules: Rule[] }) {
  const [tab, setTab] = useState<TypeTab>("all");

  const allFiles = groups.flatMap((g) => g.files);
  const count = (t: TypeTab) => allFiles.filter((f) => tabMatches[t](f.type)).length;

  const visible = groups
    .map((g) => ({ ...g, files: g.files.filter((f) => tabMatches[tab](f.type)) }))
    .filter((g) => g.files.length > 0);

  return (
    <>
      <PageTabs
        label="Quote types"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "all", label: `ALL QUOTES (${count("all")})`, icon: "all" },
          { key: "email", label: `EMAILS (${count("email")})`, icon: "mail" },
          { key: "pdf", label: `PDFS (${count("pdf")})`, icon: "file" },
          { key: "spreadsheet", label: `SPREADSHEETS (${count("spreadsheet")})`, icon: "sheet" },
        ]}
      />
      <p className="m-0 text-sm text-slate">
        Grouped by supplier, in the order they arrived. Press Process inbox and the agent works
        through all of them.
      </p>

      {visible.map((g) => (
        <SupplierCard key={g.key} group={g} />
      ))}
      {visible.length === 0 && (
        <p className="m-0 text-sm text-slate">No quotes of this type.</p>
      )}

      <RulesCard rules={rules} />
    </>
  );
}

function groupStatus(files: InboxFile[]): string {
  if (files.some((f) => f.status === "needs_review")) return "Needs you";
  if (files.some((f) => f.status === "working")) return "Working";
  if (files.every((f) => f.status === "done")) return "Done";
  return "New";
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function SupplierCard({ group }: { group: InboxGroup }) {
  const [tab, setTab] = useState<"files" | "history">("files");
  const first = group.files[0];
  const quotes = plural(group.files.length, "quote");

  return (
    <StatusCard
      colour={group.colour}
      panel={
        <>
          <StatusBox label={groupStatus(group.files)} colour={textOnPastel(group.colour)} />
          <PanelFact value={quotes} caption="In this batch" />
          <PanelDivider />
          <PanelFact value="First received" caption={`${first.day} ${first.time}`} />
        </>
      }
    >
      <CardTitle>
        {group.name} – {quotes}
      </CardTitle>
      <CardTabs
        label={`${group.name} views`}
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "files", label: "FILES" },
          { key: "history", label: "SUPPLIER HISTORY" },
        ]}
      />
      {tab === "files" ? (
        <div className="flex flex-wrap gap-3.5">
          {group.files.map((f) => (
            <FileTile key={f.id} file={f} colour={group.colour} />
          ))}
        </div>
      ) : (
        <SupplierHistory group={group} />
      )}
    </StatusCard>
  );
}

function FileTile({ file, colour }: { file: InboxFile; colour: string }) {
  return (
    <PillTile
      className="max-w-[300px] flex-[1_1_200px]"
      shadow
      pill={file.time}
      pillExtra={
        <span className="text-slate">
          <Icon name="swap" size={18} strokeWidth={1.6} />
        </span>
      }
    >
      <div className="flex items-start gap-2.5">
        <Icon name={fileIcons[file.type]} size={20} strokeWidth={1.6} />
        <span className="text-sm leading-[1.4] font-medium [overflow-wrap:anywhere]">
          {file.title}
        </span>
      </div>
      <span className="text-[13px] text-muted">{file.typeLabel}</span>
      <div className="flex items-center gap-2 text-[13px]">
        <InitialsCircle initials={file.initials} colour={colour} />
        {file.sender}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-[0.03em] text-muted uppercase">
          {fileNote(file)}
        </span>
        {file.href && (
          <a
            href={file.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold"
            aria-label={`Open ${file.title} in a new tab`}
          >
            Open
          </a>
        )}
      </div>
    </PillTile>
  );
}

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function SupplierHistory({ group }: { group: InboxGroup }) {
  if (group.isUnknown) {
    return (
      <p className="m-0 text-sm text-slate">
        We don&apos;t know who sent this file yet, so there are no past prices to show.
      </p>
    );
  }
  if (group.history.length === 0) {
    return <p className="m-0 text-sm text-slate">No past prices for {group.name} yet.</p>;
  }
  const cols = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_110px_110px] gap-2.5 px-3.5 py-2.5 min-w-[500px]";
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[13px] text-slate">
        Past approved prices from {group.name}. The agent compares new quotes with these.
      </p>
      <div className="overflow-x-auto rounded-btn border border-line-soft">
        <div className={`${cols} bg-well text-xs font-semibold tracking-[0.04em] text-slate`}>
          <span>ROUTE</span>
          <span>SERVICE</span>
          <span>PRICE (EX VAT)</span>
          <span>DATE</span>
        </div>
        {group.history.map((h) => (
          <div key={h.id} className={`${cols} border-t border-line-soft text-sm tabular-nums`}>
            <span>{h.route}</span>
            <span className="text-slate">{h.category}</span>
            <span className="font-semibold">{money.format(h.price)}</span>
            <span className="text-slate">{h.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RulesCard({ rules }: { rules: Rule[] }) {
  return (
    <StatusCard
      colour="#BDEBD3"
      panel={
        <>
          <StatusBox label="Active" colour="#1E7A44" icon="tick" />
          <PanelFact value={plural(rules.length, "rule")} caption="Plain English" />
        </>
      }
    >
      <CardTitle>Northline Couriers – Sorting rules</CardTitle>
      <DashedPill>The agent follows these every time it sorts a job</DashedPill>
      <div className="flex flex-wrap gap-3.5">
        {rules.map((r) => (
          <PillTile key={r.number} className="flex-[1_1_170px]" pill={`RULE ${r.number}`}>
            <span className="text-[13px] leading-normal">{r.text}</span>
          </PillTile>
        ))}
      </div>
    </StatusCard>
  );
}
