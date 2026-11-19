"use client";

import { useRef, useState } from "react";

// "Tutorial video" on the landing page: plays the recording in a pop-up on
// top of the page. Close with the ✕ button, the Esc key or a click outside the
// video; closing stops it. A link that isn't YouTube opens in a new tab.

const BUTTON =
  "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-btn border border-line-strong bg-white px-[22px] text-sm font-semibold tracking-[0.03em] text-ink no-underline";

/** The video id from a youtu.be or youtube.com link, or null. */
function youTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/);
      return m ? m[1] : null;
    }
  } catch {}
  return null;
}

function PlayTriangle() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3l16 9-16 9z" />
    </svg>
  );
}

export function TutorialVideo({ url }: { url: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The player only exists while open, so closing stops the video.
  const [open, setOpen] = useState(false);
  const id = youTubeId(url);

  if (!id) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={BUTTON}>
        <PlayTriangle />
        TUTORIAL VIDEO
      </a>
    );
  }

  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        className={BUTTON}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <PlayTriangle />
        TUTORIAL VIDEO
      </button>

      <dialog
        ref={dialog}
        aria-label="Tutorial video"
        onClose={() => setOpen(false)}
        // A click on the dark area around the video closes it.
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-auto w-[min(960px,calc(100vw-32px))] max-w-none overflow-visible border-0 bg-transparent p-0 backdrop:bg-[rgba(16,24,40,0.75)]"
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={close}
            aria-label="Close video"
            className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-end rounded-btn border-0 bg-white px-3.5 text-xs font-semibold tracking-[0.03em] text-ink shadow-pop"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            CLOSE
          </button>
          <div className="relative aspect-video w-full overflow-hidden rounded-card bg-black shadow-pop">
            {open && (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`}
                title="Quote Agent tutorial video"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
