"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/**
 * "Reset demo" in the sidebar footer, with a short confirmation. On success
 * the tab's own saved state (run token, Ask chat, notices) is cleared and the
 * page reloads on a fresh Inbox, so nothing from before the reset lingers.
 */
export function ResetDemo() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Something went wrong resetting the demo – try again.");
        setBusy(false);
        return;
      }
      try {
        sessionStorage.clear();
      } catch {}
      // A full reload on purpose: it also clears the run driver's in-memory
      // state and every cached page from before the reset.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/inbox");
    } catch {
      setError("Something went wrong resetting the demo – try again.");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-primary hover:text-primary-hover"
      >
        <Icon name="reset" size={14} strokeWidth={2} />
        Reset demo
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-card border border-line bg-white p-3 text-[13px] text-slate shadow-tile">
      <p className="m-0 leading-normal">
        This clears everyone&apos;s progress and restores the fresh sample inbox.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-btn border-0 bg-primary px-3.5 text-xs font-semibold tracking-[0.03em] text-white hover:bg-primary-hover disabled:cursor-default disabled:opacity-60"
        >
          {busy ? "RESETTING…" : "RESET"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-btn border border-line-strong bg-white px-3.5 text-xs font-semibold tracking-[0.03em] text-ink disabled:cursor-default disabled:opacity-60"
        >
          CANCEL
        </button>
      </div>
      {error && (
        <p role="alert" className="m-0 font-medium text-warn-text">
          {error}
        </p>
      )}
    </div>
  );
}
