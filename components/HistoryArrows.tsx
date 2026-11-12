"use client";

import { Icon } from "./Icon";

/** Back and forward arrows that move through the browser history. */
export function HistoryArrows() {
  const base =
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded-btn border-0 bg-transparent p-0 text-ink hover:bg-pill";
  return (
    <>
      <button type="button" aria-label="Back" className={base} onClick={() => window.history.back()}>
        <Icon name="back" size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label="Forward"
        className={base}
        onClick={() => window.history.forward()}
      >
        <Icon name="forward" size={16} strokeWidth={2} />
      </button>
    </>
  );
}
