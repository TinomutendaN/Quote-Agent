import { getDailyUsage, getDemoRun } from "@/lib/db";
import { dailyLimit } from "@/lib/limits";
import { DashedPill } from "./Cards";

/**
 * Shown on Inbox and Agent run when Reset loaded the saved earlier run
 * because today's limit for new runs was reached. Nothing otherwise.
 */
export async function SavedRunNote() {
  const [run, usage] = await Promise.all([getDemoRun(), getDailyUsage()]);
  if (!run.saved_run) return null;
  const limitReached = usage.runs >= dailyLimit("runs");
  return (
    <DashedPill tone="warn">
      {limitReached
        ? "Showing a real earlier run – today's limit for new runs has been reached."
        : "Showing a real earlier run – reset the demo to run the agent yourself."}
    </DashedPill>
  );
}
