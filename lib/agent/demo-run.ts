// The one shared "Process inbox" run. Everyone shares one database, so only
// one browser may run the inbox at a time; it proves ownership with run_id.
import { randomUUID } from "node:crypto";
import {
  type DemoRun,
  claimDemoRun,
  getDemoRun,
  resetStuckFiles,
} from "@/lib/db";

/** A running run with no activity for this long can be taken over. */
export const STALL_MINUTES = 10;

export type StartRunResult =
  | { started: true; run_id: string; took_over: boolean; reset_file_ids: number[]; state: DemoRun }
  | { started: false; state: DemoRun; message: string };

export async function startDemoRun(): Promise<StartRunResult> {
  const runId = randomUUID();
  const claim = await claimDemoRun(runId, STALL_MINUTES);

  if (!claim) {
    const state = await getDemoRun();
    return {
      started: false,
      state,
      message:
        state.status === "finished"
          ? "The inbox has already been processed. Showing the saved results."
          : "The agent is already working through the inbox. Showing its progress.",
    };
  }

  // Taking over a stalled run: anything left half-done goes back to waiting.
  const resetIds = claim.previous === "running" ? await resetStuckFiles() : [];
  return {
    started: true,
    run_id: runId,
    took_over: claim.previous === "running",
    reset_file_ids: resetIds,
    state: await getDemoRun(),
  };
}
