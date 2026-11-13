// Daily caps for the shared public demo, so it can't run up model costs.
// Counted per UK day in the daily_usage table, which Reset demo never clears.
// Set on the server (.env.local / Vercel); a missing or invalid value uses the default.

export type UsageKind = "runs" | "uploads" | "questions";

const DEFAULTS: Record<UsageKind, number> = { runs: 15, uploads: 40, questions: 150 };

const SETTINGS: Record<UsageKind, string> = {
  runs: "DAILY_MAX_RUNS",
  uploads: "DAILY_MAX_UPLOADS",
  questions: "DAILY_MAX_QUESTIONS",
};

/** Today's limit for one kind of use. */
export function dailyLimit(kind: UsageKind): number {
  const raw = process.env[SETTINGS[kind]]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULTS[kind];
  return Number(raw);
}

/** Shown when a daily limit is reached. */
export const LIMIT_MESSAGES: Record<UsageKind, string> = {
  runs: "The demo has reached today's limit for new runs – it resets at midnight UK time.",
  uploads: "The demo has reached today's limit for added quotes – it resets at midnight UK time.",
  questions: "The demo has reached today's limit for questions – it resets at midnight UK time.",
};

/** Reset demo runs at most once a minute across all visitors. */
export const RESET_COOLDOWN_SECONDS = 60;
