"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CardTitle, PanelDivider, PanelFact, StatusBox, StatusCard } from "@/components/Cards";
import { Icon } from "@/components/Icon";
import { HeaderButton, HeaderLink, PageHeader } from "@/components/PageHeader";
import { ProgressBar } from "@/components/ProgressBar";
import { type LiveSnapshot, fetchSnapshot, useRunDriver } from "@/components/RunDriver";
import { CardTabs, PageTabs } from "@/components/Tabs";
import { displayFileName, fileCardTitle } from "@/lib/fileNames";
import { doingPhrase, formatDuration, groupSteps, toolTint } from "@/lib/agent/steps";
import type { SnapshotEvent, SnapshotFile, SnapshotLine, SnapshotReview } from "@/lib/db";

const POLL_MS = 2000;

type PageTab = "live" | "data" | "log";

const LOOK = {
  working: { panel: "#CDBDF2", fg: "#5B21B6", label: "Working", end: "IN PROGRESS", endFg: "#5B21B6" },
  needs_review: { panel: "#FBBDAB", fg: "#A3260C", label: "Needs you", end: "SENT TO REVIEW", endFg: "#B45309" },
  done: { panel: "#B9D6FB", fg: "#1D4ED8", label: "Done", end: "READY", endFg: "#1D4ED8" },
  // Sent to review during the run, and every item on it has since been handled.
  reviewed: { panel: "#B9D6FB", fg: "#1D4ED8", label: "Reviewed", end: "SENT TO REVIEW", endFg: "#B45309" },
} as const;

/** Files with at least one review item still waiting for a person. */
function filesNeedingYou(snap: LiveSnapshot): Set<number> {
  return new Set(
    snap.reviews.filter((r) => r.status === "open" && r.source_file_id !== null).map((r) => r.source_file_id!),
  );
}

const REASON_LABEL: Record<SnapshotReview["reason_type"], string> = {
  price_wrong: "Price looks wrong",
  duplicate: "Possible duplicate",
  unclear: "Unclear",
  unknown_sender: "Unknown sender",
};

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const isInbox = (f: SnapshotFile) => !f.is_held_back && !f.is_upload;

/** `note`: shown under the tabs (e.g. "Showing a real earlier run"). */
export function AgentRunView({ initial, note }: { initial: LiveSnapshot; note?: ReactNode }) {
  const router = useRouter();
  const driver = useRunDriver();
  const [snap, setSnap] = useState<LiveSnapshot>(initial);
  const [tab, setTab] = useState<PageTab>("live");

  // Keep up to date while anything is happening; stop when nothing is.
  const anyWorking = snap.files.some((f) => f.status === "working");
  const shouldPoll = snap.run.status === "running" || anyWorking || driver.active || driver.uploading;
  const runId = driver.runId;
  useEffect(() => {
    if (!shouldPoll) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await fetchSnapshot(runId);
        if (!stopped) setSnap(next);
      } catch {
        // Try again on the next tick.
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [shouldPoll, runId]);

  // One last read when this browser stops sending files or uploading.
  const busy = driver.active || driver.uploading;
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) fetchSnapshot(runId).then(setSnap).catch(() => {});
    wasBusy.current = busy;
  }, [busy, runId]);

  // A tab left open here catches up (e.g. after items are handled in Review queue).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") fetchSnapshot(runId).then(setSnap).catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [runId]);

  const openReviews = snap.reviews.filter((r) => r.status === "open").length;

  // Keep the sidebar badge in step with the live count.
  const lastOpen = useRef(openReviews);
  useEffect(() => {
    if (lastOpen.current !== openReviews) {
      lastOpen.current = openReviews;
      router.refresh();
    }
  }, [openReviews, router]);

  const showControls = driver.isDriver && (snap.run.status === "running" || driver.active || driver.paused);
  const running = driver.active && !driver.paused;

  return (
    <>
      <PageHeader
        breadcrumb="Agent run"
        title="Agent run"
        beta
        actions={
          <>
            {showControls && (
              <HeaderButton onClick={running ? driver.pause : driver.resume}>
                {running ? "PAUSE AGENT" : "RESUME"}
              </HeaderButton>
            )}
            <HeaderLink href="/review" primary>
              OPEN REVIEW QUEUE ({openReviews})
            </HeaderLink>
          </>
        }
      />
      <PageTabs
        label="Views"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "live", label: "LIVE RUN", icon: "live" },
          { key: "data", label: "EXTRACTED DATA", icon: "table" },
          { key: "log", label: "ACTIVITY LOG", icon: "log" },
        ]}
      />
      {note}
      {driver.notice && <Notice text={driver.notice} />}
      {driver.paused && driver.active && (
        <p className="m-0 text-sm text-slate">
          Pausing – the quotes already being read will finish first.
        </p>
      )}
      <RunSummary snap={snap} />
      {tab === "live" && <LiveRun snap={snap} />}
      {tab === "data" && <ExtractedData snap={snap} />}
      {tab === "log" && <ActivityLog snap={snap} />}
    </>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2 self-start rounded-btn border-[1.5px] border-dashed border-warn-line bg-warn-bg px-3 py-[7px] text-[13px] font-medium text-warn-text">
      <Icon name="warning" size={16} strokeWidth={1.8} />
      {text}
    </span>
  );
}

function RunSummary({ snap }: { snap: LiveSnapshot }) {
  // Run progress counts the inbox only: never file 16 or uploads.
  // "Need you" counts files with an open review item, not the file status:
  // once its items are handled a file counts as Ready.
  const inbox = snap.files.filter(isInbox);
  const needing = filesNeedingYou(snap);
  const finished = inbox.filter((f) => f.status === "done" || f.status === "needs_review");
  const need = finished.filter((f) => needing.has(f.id)).length;
  const ready = finished.length - need;
  const working = inbox.filter((f) => f.status === "working").length;
  const waiting = inbox.filter((f) => f.status === "waiting").length;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1.5 text-[15px]">
        <span>
          Goal: <strong>turn the inbox into clean, sorted price data</strong>
        </span>
        <span className="text-muted">•</span>
        <span>
          Quotes handled:{" "}
          <strong>
            {ready + need} of {inbox.length}
          </strong>
        </span>
      </div>
      <ProgressBar
        segments={[
          { weight: ready, colour: "ready", label: <><strong>{ready} Ready</strong> (clean and sorted)</> },
          { weight: need, colour: "need", label: <strong>{need} Need you</strong> },
          { weight: working, colour: "grey", label: <><strong>{working}</strong> Working</> },
          { weight: waiting, colour: "grey", label: <><strong>{waiting}</strong> Waiting</> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Live run
// ---------------------------------------------------------------------------

function useByFile(snap: LiveSnapshot) {
  return useMemo(() => {
    const events = new Map<number, SnapshotEvent[]>();
    for (const e of snap.events) {
      const list = events.get(e.source_file_id) ?? [];
      list.push(e);
      events.set(e.source_file_id, list);
    }
    const lines = new Map<number, SnapshotLine[]>();
    for (const l of snap.lines) {
      const list = lines.get(l.source_file_id) ?? [];
      list.push(l);
      lines.set(l.source_file_id, list);
    }
    const openByLine = new Map<number, SnapshotReview>();
    const openByFile = new Map<number, SnapshotReview[]>();
    for (const r of snap.reviews) {
      if (r.status !== "open") continue;
      if (r.quote_line_id !== null) openByLine.set(r.quote_line_id, r);
      if (r.source_file_id !== null) {
        const list = openByFile.get(r.source_file_id) ?? [];
        list.push(r);
        openByFile.set(r.source_file_id, list);
      }
    }
    return { events, lines, openByLine, openByFile };
  }, [snap]);
}

function LiveRun({ snap }: { snap: LiveSnapshot }) {
  const by = useByFile(snap);
  const firstEventId = (f: SnapshotFile) => by.events.get(f.id)?.[0]?.id ?? Number.MAX_SAFE_INTEGER;

  const started = snap.files.filter((f) => f.status !== "waiting");
  const working = started
    .filter((f) => f.status === "working")
    .sort((a, b) => firstEventId(a) - firstEventId(b));
  const finished = started
    .filter((f) => f.status !== "working")
    .sort((a, b) => (b.last_event_at ?? "").localeCompare(a.last_event_at ?? ""));
  const cards = [...working, ...finished];
  const waiting = snap.files.filter((f) => isInbox(f) && f.status === "waiting").length;

  return (
    <div className="flex flex-wrap items-start gap-[18px]">
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
        {cards.length === 0 && <NotStarted status={snap.run.status} />}
        {cards.map((f) => (
          <RunCard
            key={f.id}
            file={f}
            events={by.events.get(f.id) ?? []}
            lines={by.lines.get(f.id) ?? []}
            openByLine={by.openByLine}
            fileReviews={by.openByFile.get(f.id) ?? []}
          />
        ))}
        {cards.length > 0 && waiting > 0 && (
          <p className="m-0 rounded-pill bg-pill px-3.5 py-3 text-[15px]">
            <strong>{plural(waiting, "quote")}</strong> waiting
          </p>
        )}
      </div>
      <AgentPanel snap={snap} working={working} />
    </div>
  );
}

function NotStarted({ status }: { status: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-white px-[22px] py-[18px] shadow-card">
      <h2 className="m-0 text-lg font-medium">
        {status === "running" ? "The agent is starting…" : "The agent hasn't run yet"}
      </h2>
      {status !== "running" && (
        <p className="m-0 text-sm text-slate">
          Go to the <Link href="/inbox">Inbox</Link> and press Process inbox. Each quote then
          appears here as the agent works through it.
        </p>
      )}
    </div>
  );
}

type CardTab = "steps" | "result" | "original";

function RunCard({
  file,
  events,
  lines,
  openByLine,
  fileReviews,
}: {
  file: SnapshotFile;
  events: SnapshotEvent[];
  lines: SnapshotLine[];
  openByLine: Map<number, SnapshotReview>;
  fileReviews: SnapshotReview[];
}) {
  const [tab, setTab] = useState<CardTab>("steps");
  const look =
    file.status === "needs_review" && fileReviews.length === 0
      ? LOOK.reviewed
      : (LOOK[file.status as keyof typeof LOOK] ?? LOOK.working);
  const tiles = groupSteps(events, file);

  return (
    <StatusCard
      colour={look.panel}
      panel={
        <>
          <StatusBox label={look.label} colour={look.fg} />
          <PanelFact value={plural(tiles.length, "step")} caption="Steps taken" />
          <PanelDivider />
          <PanelFact value="Started" caption={file.started_time ?? "–"} />
        </>
      }
    >
      <CardTitle>{fileCardTitle(file)}</CardTitle>
      <CardTabs
        label={`${displayFileName(file)} views`}
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "steps", label: "STEPS" },
          { key: "result", label: "RESULT" },
          { key: "original", label: "ORIGINAL FILE" },
        ]}
      />
      {tab === "steps" && (
        <>
          <span className="text-xs font-semibold tracking-[0.04em] text-slate">
            {file.status === "working" ? "NOW" : "FINISHED"}
          </span>
          <div className="flex items-stretch gap-3.5">
            <div className="w-0.5 flex-none rounded-sm bg-primary" />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3.5">
              {tiles.length === 0 && (
                <span className="flex-[1_1_170px] text-[13px] text-muted">Opening the file…</span>
              )}
              {tiles.map((t) => (
                <div key={t.step} className="flex min-w-0 flex-[1_1_170px] flex-col gap-2 self-stretch">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 rounded-pill bg-pill p-1 text-center text-xs font-semibold">
                      STEP {t.step}
                    </span>
                    <span className="text-slate">
                      <Icon name="swap" size={18} strokeWidth={1.6} />
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-[9px] rounded-btn border border-line-soft p-3 shadow-tile">
                    <div className="flex items-start gap-2.5">
                      <Icon name="step" size={20} strokeWidth={1.6} />
                      <span className="text-sm leading-[1.4] font-medium">{t.title}</span>
                    </div>
                    <span className="text-[13px] text-muted">{t.time}</span>
                    <ToolChip tool={t.tool} />
                    <span className="text-[13px] leading-[1.45] [overflow-wrap:anywhere] text-slate">
                      {t.note}
                    </span>
                  </div>
                </div>
              ))}
              <div
                className="box-border flex h-24 w-24 flex-none items-center justify-center rounded-full p-2 text-center text-[11px] leading-[1.3] font-bold tracking-[0.03em]"
                style={{ border: `1.5px solid ${look.endFg}`, color: look.endFg }}
              >
                {look.end}
              </div>
            </div>
          </div>
        </>
      )}
      {tab === "result" && (
        <FileResult file={file} lines={lines} openByLine={openByLine} fileReviews={fileReviews} />
      )}
      {tab === "original" && <OriginalFile file={file} />}
    </StatusCard>
  );
}

function ToolChip({ tool }: { tool: string }) {
  return (
    <span className="self-start rounded-pill bg-nav-active px-1.5 py-0.5 font-mono text-[11px] text-ink">
      {tool}
    </span>
  );
}

function serviceLabel(l: SnapshotLine): string {
  if (!l.category) return "Not sorted yet";
  return l.rule_number ? `${l.category} (rule ${l.rule_number})` : l.category;
}

function FileResult({
  file,
  lines,
  openByLine,
  fileReviews,
}: {
  file: SnapshotFile;
  lines: SnapshotLine[];
  openByLine: Map<number, SnapshotReview>;
  fileReviews: SnapshotReview[];
}) {
  const fileLevel = fileReviews.filter((r) => r.quote_line_id === null);
  if (lines.length === 0) {
    return (
      <p className="m-0 text-sm text-slate">
        {file.status === "working" ? "No prices saved from this file yet." : "No prices were saved from this file."}
      </p>
    );
  }
  const cols =
    "grid min-w-[560px] grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_100px_minmax(0,1fr)_minmax(0,1fr)] gap-2.5 px-3.5 py-2.5";
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[13px] text-slate">
        {plural(lines.length, "price")} saved from this file.
        {fileLevel.map((r) => ` ${REASON_LABEL[r.reason_type]}: sent to review.`).join("")}
      </p>
      <div className="overflow-x-auto rounded-btn border border-line-soft">
        <div className={`${cols} bg-well text-xs font-semibold tracking-[0.04em] text-slate`}>
          <span>ROUTE</span>
          <span>SERVICE</span>
          <span>PRICE (EX VAT)</span>
          <span>UNIT</span>
          <span>CHECK</span>
        </div>
        {lines.map((l) => {
          const flag = openByLine.get(l.id);
          return (
            <div key={l.id} className={`${cols} border-t border-line-soft text-sm tabular-nums`}>
              <span>{l.route}</span>
              <span className="text-slate">{serviceLabel(l)}</span>
              <span className="font-semibold">{money.format(Number(l.price))}</span>
              <span className="text-slate">{l.unit_note ?? "–"}</span>
              <span className={flag ? "font-medium text-on-salmon" : "text-on-mint"}>
                {flag ? REASON_LABEL[flag.reason_type] : "Clean"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OriginalFile({ file }: { file: SnapshotFile }) {
  if (file.is_upload || !file.file_path) {
    return (
      <p className="m-0 text-sm text-slate">
        This file was uploaded. The original of uploaded files isn&apos;t kept, only the prices
        the agent saved from it.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <a
        href={file.file_path}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-2 self-start text-[13px] font-semibold tracking-[0.03em] no-underline"
      >
        <Icon name={file.type === "email" ? "mail" : file.type === "spreadsheet" ? "sheet" : "file"} size={18} />
        OPEN THE ORIGINAL FILE
      </a>
      <span className="text-[13px] text-muted">
        Opens {displayFileName(file)} in a new tab, exactly as it arrived on {file.received_day} at{" "}
        {file.received_time}.
      </span>
    </div>
  );
}

function AgentPanel({ snap, working }: { snap: LiveSnapshot; working: SnapshotFile[] }) {
  const current = [...working].sort((a, b) =>
    (b.last_event_at ?? "").localeCompare(a.last_event_at ?? ""),
  )[0];
  const lastEvent = current
    ? [...snap.events].reverse().find((e) => e.source_file_id === current.id)
    : undefined;
  const latest = snap.events
    .map((e, i) => ({ e, n: i + 1 }))
    .slice(-8)
    .reverse();
  const fileById = new Map(snap.files.map((f) => [f.id, f]));
  const inbox = snap.files.filter(isInbox);
  const handled = inbox.filter((f) => f.status === "done" || f.status === "needs_review").length;

  let title: string;
  let subtitle: string;
  if (current) {
    title = fileCardTitle(current);
    subtitle = doingPhrase(lastEvent?.tool_name ?? null);
  } else if (snap.run.status === "idle") {
    title = "Not started yet";
    subtitle = "Press Process inbox on the Inbox to start.";
  } else if (snap.run.status === "finished") {
    title = "All quotes handled";
    subtitle = `${handled} of ${inbox.length} inbox quotes done.`;
  } else {
    title = "Between quotes";
    subtitle = "Waiting for the next quote to start.";
  }

  return (
    <aside
      aria-label="What the agent is doing"
      // When the columns wrap (narrow screens) the panel goes above the cards.
      className="flex min-w-0 flex-[1_1_290px] flex-col gap-3 rounded-lg border border-line bg-white px-[18px] py-4 shadow-pop max-[1170px]:order-first"
    >
      <span className="text-xs font-semibold tracking-[0.04em] text-slate">CURRENT JOB</span>
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
          style={{ background: current?.supplier_colour ?? "#CDBDF2" }}
        >
          <Icon name="file" size={20} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5 text-sm">
          <strong className="font-semibold [overflow-wrap:anywhere]">{title}</strong>
          <span className="text-[13px] text-muted">{subtitle}</span>
        </div>
      </div>
      <div className="h-px bg-line-soft" />
      <span className="text-xs font-semibold tracking-[0.04em] text-slate">WHAT THE AGENT IS DOING</span>
      {latest.length === 0 && <p className="m-0 text-[13px] text-muted">Nothing yet.</p>}
      {latest.map(({ e, n }) => {
        const f = fileById.get(e.source_file_id);
        return (
          <div key={e.id} className="flex gap-3 border-b border-line-soft pb-3">
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold"
              style={{ background: toolTint(e.tool_name) }}
            >
              {n}
            </span>
            <div className="flex min-w-0 flex-col gap-[5px]">
              <span className="text-[13px] leading-[1.45] [overflow-wrap:anywhere]">
                {f && <span className="text-muted">{f.supplier_name ?? "Unknown sender"}: </span>}
                {e.text}
              </span>
              <ToolChip tool={e.tool_name} />
            </div>
          </div>
        );
      })}
      <Link
        href="/review"
        className="inline-flex min-h-11 items-center self-end text-[13px] font-semibold tracking-[0.03em] no-underline"
      >
        SEE FLAGGED ITEMS
      </Link>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Extracted data and Activity log
// ---------------------------------------------------------------------------

function ExtractedData({ snap }: { snap: LiveSnapshot }) {
  const by = useByFile(snap);
  const fileById = new Map(snap.files.map((f) => [f.id, f]));
  if (snap.lines.length === 0) {
    return <p className="m-0 text-sm text-slate">No prices saved yet. They appear here as the agent saves them.</p>;
  }
  const cols =
    "grid min-w-[900px] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_90px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2.5 px-3.5 py-2.5";
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-sm text-slate">
        {plural(snap.lines.length, "price")} saved by the agent, in the order they were found. Past
        prices are not included.
      </p>
      <div className="overflow-x-auto rounded-btn border border-line bg-white">
        <div className={`${cols} bg-well text-xs font-semibold tracking-[0.04em] text-slate`}>
          <span>FILE</span>
          <span>SUPPLIER</span>
          <span>ROUTE</span>
          <span>SERVICE</span>
          <span>PRICE</span>
          <span>UNIT</span>
          <span>VAT</span>
          <span>CHECK</span>
        </div>
        {snap.lines.map((l) => {
          const f = fileById.get(l.source_file_id);
          const flag = by.openByLine.get(l.id);
          return (
            <div key={l.id} className={`${cols} border-t border-line-soft text-sm tabular-nums`}>
              <span className="[overflow-wrap:anywhere]">{f ? displayFileName(f) : "–"}</span>
              <span className="text-slate">{l.supplier_name ?? "Unknown sender"}</span>
              <span>{l.route}</span>
              <span className="text-slate">{serviceLabel(l)}</span>
              <span className="font-semibold">{money.format(Number(l.price))}</span>
              <span className="text-slate">{l.unit_note ?? "–"}</span>
              <span className="text-slate">{l.vat_note ?? "–"}</span>
              <span className={flag ? "font-medium text-on-salmon" : "text-on-mint"}>
                {flag ? REASON_LABEL[flag.reason_type] : "Clean"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityLog({ snap }: { snap: LiveSnapshot }) {
  const fileById = new Map(snap.files.map((f) => [f.id, f]));
  if (snap.events.length === 0) {
    return <p className="m-0 text-sm text-slate">Nothing has happened yet. Every step the agent takes is listed here.</p>;
  }
  const cols =
    "grid min-w-[820px] grid-cols-[80px_minmax(0,1.3fr)_50px_150px_minmax(0,3fr)_80px] items-start gap-2.5 px-3.5 py-2.5";
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-sm text-slate">
        Every step the agent took ({snap.events.length}), newest first.
      </p>
      <div className="overflow-x-auto rounded-btn border border-line bg-white">
        <div className={`${cols} bg-well text-xs font-semibold tracking-[0.04em] text-slate`}>
          <span>TIME</span>
          <span>FILE</span>
          <span>STEP</span>
          <span>TOOL</span>
          <span>WHAT HAPPENED</span>
          <span>TOOK</span>
        </div>
        {[...snap.events].reverse().map((e) => {
          const f = fileById.get(e.source_file_id);
          return (
            <div key={e.id} className={`${cols} border-t border-line-soft text-sm`}>
              <span className="text-slate tabular-nums">{e.time}</span>
              <span className="[overflow-wrap:anywhere]">{f ? displayFileName(f) : "–"}</span>
              <span className="text-slate tabular-nums">{e.step_number}</span>
              <ToolChip tool={e.tool_name} />
              <span className="leading-[1.45] [overflow-wrap:anywhere]">{e.text}</span>
              <span className="text-slate tabular-nums">
                {e.duration_ms === null ? "–" : formatDuration(e.duration_ms)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

