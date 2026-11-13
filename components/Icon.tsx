// Outline icons used across the designs. Paths are copied from docs/design.

export const iconPaths = {
  // Sidebar menu
  inbox: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z",
  agent: "M7 7h10v10H7zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3",
  review: "M4 4h16v16H4zM8 12l3 3 5-6",
  price: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
  ask: "M4 5h16v11H9l-5 4z",
  // File types and tabs
  all: "M4 6h16M4 12h16M4 18h16",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  sheet: "M4 4h16v16H4zM4 10h16M4 15h16M10 4v16",
  // Agent run
  live: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  table: "M4 5h16v14H4zM4 10h16M10 10v9",
  log: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
  step: "M14 4l6 6-9 9H5v-6zM12 6l6 6",
  // Review queue
  duplicate: "M8 8h12v12H8zM4 4h12v4M4 4v12h4",
  question: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 17h.01",
  person: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1",
  pin: "M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  // Misc
  back: "M15 6l-6 6 6 6",
  forward: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  tick: "M5 12l5 5 9-10",
  swap: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
  warning: "M12 3l10 18H2zM12 10v4M12 17h.01",
  reset: "M4 4v6h6M20 20v-6h-6M5 10a8 8 0 0 1 14-3M19 14a8 8 0 0 1-14 3",
  logo: "M4 6h16M4 12h10M4 18h7",
} as const;

export type IconName = keyof typeof iconPaths;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flex: "none" }}
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

/** The clock used in status panels. */
export function ClockIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Solid play triangle (Process inbox). */
export function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}
