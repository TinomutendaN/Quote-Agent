// Plain-English names for the agent's tool calls, and the grouping of a
// file's events into the step tiles on the Agent run screen.
// Shared by server and browser: no imports, no server-only code.

export type StepEvent = {
  id: number;
  step_number: number;
  tool_name: string;
  text: string;
  duration_ms: number | null;
};

export type StepTile = {
  /** 1-based position of the tile on the card. */
  step: number;
  tool: string;
  title: string;
  /** e.g. "2.1 sec" */
  time: string;
  note: string;
  /** Number of tool calls in this tile. */
  count: number;
};

type FileKind = { type: string; file_name: string };

function readTitle(file: FileKind): string {
  const ext = file.file_name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return "Read the photo";
  switch (file.type) {
    case "email":
      return "Read the email";
    case "pdf":
      return "Read the PDF";
    case "scan":
      return "Read the scanned page";
    case "spreadsheet":
      return "Read the spreadsheet";
    default:
      return "Read the file";
  }
}

/** Tile title for `count` consecutive calls of one tool. */
export function stepTitle(tool: string, count: number, file: FileKind): string {
  switch (tool) {
    case "read_file":
      return readTitle(file);
    case "save_quote_line":
      return count === 1 ? "Save the price" : `Save ${count} prices`;
    case "apply_rules":
      return count === 1 ? "Sort with your rules" : `Sort ${count} prices with your rules`;
    case "compare_history":
      return "Compare with past prices";
    case "check_duplicates":
      return "Check for duplicates";
    case "flag_for_review":
      return count === 1 ? "Send for review" : `Send ${count} items for review`;
    case "identify_supplier":
      return "Work out the supplier";
    default:
      return "Work on the quote";
  }
}

/** What the agent is doing right now, for the "Current job" panel. */
export function doingPhrase(tool: string | null): string {
  switch (tool) {
    case "read_file":
      return "Reading the file";
    case "save_quote_line":
      return "Pulling out the prices";
    case "apply_rules":
      return "Sorting jobs with your rules";
    case "compare_history":
      return "Comparing with past prices";
    case "check_duplicates":
      return "Checking for duplicates";
    case "flag_for_review":
      return "Sending something for review";
    case "identify_supplier":
      return "Working out who sent it";
    default:
      return "Reading the file";
  }
}

/** Background of the numbered circle in the activity list. */
export function toolTint(tool: string): string {
  switch (tool) {
    case "read_file":
    case "save_quote_line":
      return "#B9D6FB";
    case "apply_rules":
      return "#BDEBD3";
    case "compare_history":
      return "#FDE68A";
    case "check_duplicates":
      return "#CDBDF2";
    case "flag_for_review":
      return "#FDE7DF";
    default:
      return "#E9EBEF";
  }
}

/** 2100 → "2.1 sec", 12400 → "12 sec", 75000 → "1 min 15 sec". */
export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} sec`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} sec`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return sec ? `${min} min ${sec} sec` : `${min} min`;
}

/**
 * Groups a file's events (in order) into tiles: consecutive calls of the same
 * tool become one tile, because the model calls tools in parallel batches
 * (a 12-row spreadsheet would otherwise show about 48 tiles).
 */
export function groupSteps(events: StepEvent[], file: FileKind): StepTile[] {
  const sorted = [...events].sort((a, b) => a.step_number - b.step_number || a.id - b.id);
  const groups: StepEvent[][] = [];
  for (const event of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0].tool_name === event.tool_name) last.push(event);
    else groups.push([event]);
  }
  return groups.map((group, i) => {
    const latest = group[group.length - 1];
    const ms = group.reduce((sum, e) => sum + (e.duration_ms ?? 0), 0);
    return {
      step: i + 1,
      tool: latest.tool_name,
      title: stepTitle(latest.tool_name, group.length, file),
      time: formatDuration(ms),
      note:
        group.length === 1
          ? latest.text
          : `${latest.text} (and ${group.length - 1} more)`,
      count: group.length,
    };
  });
}
