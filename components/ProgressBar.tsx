import type { ReactNode } from "react";

export type ProgressSegment = {
  /** Relative width (e.g. a count). Segments with weight 0 are hidden. */
  weight: number;
  colour: "ready" | "need" | "grey";
  label: ReactNode;
};

const colours = {
  ready: "bg-ready",
  need: "bg-need",
  grey: "bg-pill",
};

/** Segmented bar: wide coloured blocks whose widths follow their counts. */
export function ProgressBar({ segments }: { segments: ProgressSegment[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {segments
        .filter((s) => s.weight > 0)
        .map((s, i) => (
          <div
            key={i}
            className={`rounded-pill px-3.5 py-3 text-[15px] ${colours[s.colour]}`}
            style={{ flex: `${s.weight} 1 120px` }}
          >
            {s.label}
          </div>
        ))}
    </div>
  );
}
