"use client";

// Drives the shared inbox run from this browser. It sits in the app layout,
// so the run keeps going while the visitor moves between app pages.
//
// Process inbox → POST /api/run. The one browser that gets a run_id loads the
// files (after that call: a takeover puts stuck files back to waiting) and
// sends them to /api/agent in the supplier queues from lib/agent/queues.ts.
// The screens never read the agent's streams: every visitor, this one
// included, watches the run through GET /api/run/live.
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MAX_PARALLEL_FILES, buildInboxQueues, runQueues } from "@/lib/agent/queues";
import type { RunSnapshot } from "@/lib/db";

export type LiveSnapshot = RunSnapshot & { you_drive: boolean };

const STORAGE_KEY = "quote-agent-run-id";

type RunDriver = {
  /** This browser holds the run token (shows Pause / Resume). */
  isDriver: boolean;
  /** Files are being sent from this browser right now. */
  active: boolean;
  paused: boolean;
  starting: boolean;
  notice: string | null;
  processInbox: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** run_id for /api/run/live, so it can say whether this browser drives. */
  runId: string | null;
};

const Ctx = createContext<RunDriver | null>(null);

export function useRunDriver(): RunDriver {
  const value = useContext(Ctx);
  if (!value) throw new Error("useRunDriver must be used inside RunDriverProvider");
  return value;
}

function readStoredRunId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeRunId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export async function fetchSnapshot(runId?: string | null): Promise<LiveSnapshot> {
  const url = runId ? `/api/run/live?run_id=${encodeURIComponent(runId)}` : "/api/run/live";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Sends one file to the agent and reads its stream to the end. true = finished. */
async function processFile(fileId: number, runId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_file_id: fileId, run_id: runId }),
    });
    if (!res.ok || !res.body) return false;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let finished = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += value;
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "finish") finished = true;
          if (event.type === "error") finished = false;
        } catch {}
      }
      if (done) break;
    }
    return finished;
  } catch {
    return false;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Files sent at once from this browser. Over HTTP/1.1 (e.g. `next dev` on
 * localhost) a browser opens at most 6 connections per site, shared by every
 * tab, and each file holds one open for its whole stream. So there we send 4,
 * leaving room for the live refresh and a second tab. HTTP/2 and later
 * (Vercel) share one connection, so the full MAX_PARALLEL_FILES is used.
 */
function parallelFiles(): number {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const protocol = nav?.nextHopProtocol ?? "";
    if (protocol === "h2" || protocol === "h3") return MAX_PARALLEL_FILES;
  } catch {}
  return 4;
}

export function RunDriverProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const runIdRef = useRef<string | null>(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(false);
  const restartRef = useRef(false);

  const setPausedBoth = (value: boolean) => {
    pausedRef.current = value;
    setPaused(value);
  };

  const forgetRun = useCallback(() => {
    runIdRef.current = null;
    setRunId(null);
    storeRunId(null);
  }, []);

  /** Runs file 16 once, if every inbox file is finished and it is still waiting. */
  const runHeldBackIfReady = useCallback(
    async (id: string): Promise<"ran" | "failed" | "not_ready" | "none"> => {
      const snap = await fetchSnapshot();
      const inbox = snap.files.filter((f) => !f.is_held_back && !f.is_upload);
      if (!inbox.every((f) => f.status === "done" || f.status === "needs_review")) return "not_ready";
      const held = snap.files.find((f) => f.is_held_back && f.status === "waiting");
      if (!held) return "none";
      return (await processFile(held.id, id)) ? "ran" : "failed";
    },
    [],
  );

  const drive = useCallback(async () => {
    const id = runIdRef.current;
    if (!id || activeRef.current) return;
    activeRef.current = true;
    setActive(true);
    setNotice(null);
    try {
      let failed = 0;
      do {
        restartRef.current = false;
        failed = 0;
        // Read the files now: a takeover may have put stuck files back to waiting.
        const snap = await fetchSnapshot();
        const queues = buildInboxQueues(snap.files);
        await runQueues(
          queues,
          async (file) => {
            const ok = await processFile(file.id, id);
            if (!ok) failed++;
            return ok;
          },
          { maxParallel: parallelFiles(), shouldStop: () => pausedRef.current },
        );
        // Resume pressed while the last files of a pause were still finishing.
      } while (restartRef.current && !pausedRef.current);

      if (pausedRef.current) return;

      const held = await runHeldBackIfReady(id);
      if (held === "not_ready" && failed > 0) {
        setPausedBoth(true);
        setNotice(
          `Something went wrong reading ${plural(failed, "quote")} – press Resume to try again.`,
        );
      } else if (held === "failed") {
        setPausedBoth(true);
        setNotice("Something went wrong reading the new quote – press Resume to try again.");
      } else if (held !== "not_ready") {
        // All done, including the new quote.
        forgetRun();
      }
    } catch {
      setPausedBoth(true);
      setNotice("Lost touch with the agent – press Resume to carry on.");
    } finally {
      activeRef.current = false;
      setActive(false);
      router.refresh();
    }
  }, [forgetRun, router, runHeldBackIfReady]);

  // A driver who reloads gets the run back, paused, with Resume.
  useEffect(() => {
    const stored = readStoredRunId();
    if (!stored) return;
    let cancelled = false;
    fetchSnapshot(stored)
      .then((snap) => {
        if (cancelled) return;
        const heldWaiting = snap.files.some((f) => f.is_held_back && f.status === "waiting");
        const stillOwns =
          snap.you_drive && (snap.run.status === "running" || heldWaiting);
        if (stillOwns) {
          runIdRef.current = stored;
          setRunId(stored);
          setPausedBoth(true);
        } else {
          storeRunId(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const processInbox = useCallback(async () => {
    if (activeRef.current) {
      router.push("/agent");
      return;
    }
    setStarting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/run", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setNotice(body?.error ?? "Something went wrong starting the agent – try again.");
        return;
      }
      if (body.started) {
        runIdRef.current = body.run_id;
        setRunId(body.run_id);
        storeRunId(body.run_id);
        setPausedBoth(false);
        router.push("/agent");
        void drive();
      } else if (runIdRef.current) {
        // This browser already drives the run (e.g. paused after a reload).
        router.push("/agent");
      } else {
        router.push("/agent");
      }
    } catch {
      setNotice("Something went wrong starting the agent – try again.");
    } finally {
      setStarting(false);
    }
  }, [drive, router]);

  const pause = useCallback(() => {
    setPausedBoth(true);
  }, []);

  const resume = useCallback(() => {
    if (!runIdRef.current) return;
    setPausedBoth(false);
    setNotice(null);
    if (activeRef.current) restartRef.current = true;
    else void drive();
  }, [drive]);

  const value = useMemo<RunDriver>(
    () => ({
      isDriver: runId !== null,
      active,
      paused,
      starting,
      notice,
      processInbox,
      pause,
      resume,
      runId,
    }),
    [runId, active, paused, starting, notice, processInbox, pause, resume],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
