// The one shared "Process inbox" run. Everyone shares one database, so only
// one browser may run the inbox at a time; it proves ownership with run_id.
import { randomUUID } from "node:crypto";
import {
  type DemoRun,
  claimDemoRun,
  claimHeldBackRun,
  deleteStalledUploads,
  getDemoRun,
  resetStalledHeldBack,
  resetStuckFiles,
} from "@/lib/db";

/** A running run with no activity for this long can be taken over. */
export const STALL_MINUTES = 10;

export type StartRunResult =
  | {
      started: true;
      /** "inbox": run the supplier queues. "held_back": the run is finished, run just file 16. */
      mode: "inbox" | "held_back";
      run_id: string;
      took_over: boolean;
      reset_file_ids: number[];
      state: DemoRun;
    }
  | { started: false; state: DemoRun; message: string };

export async function startDemoRun(): Promise<StartRunResult> {
  // Same occasion as the stall check: clear uploads whose request was cut off.
  await deleteStalledUploads(STALL_MINUTES);
  const runId = randomUUID();
  const claim = await claimDemoRun(runId, STALL_MINUTES);

  if (claim) {
    // Taking over a stalled run: anything left half-done goes back to waiting.
    const resetIds = claim.previous === "running" ? await resetStuckFiles() : [];
    return {
      started: true,
      mode: "inbox",
      run_id: runId,
      took_over: claim.previous === "running",
      reset_file_ids: resetIds,
      state: await getDemoRun(),
    };
  }

  // Finished, but the new quote (file 16) never ran (e.g. the driver left).
  let state = await getDemoRun();
  if (state.status === "finished") {
    await resetStalledHeldBack(STALL_MINUTES);
    if (await claimHeldBackRun(runId)) {
      return {
        started: true,
        mode: "held_back",
        run_id: runId,
        took_over: false,
        reset_file_ids: [],
        state,
      };
    }
    state = await getDemoRun();
  }

  return {
    started: false,
    state,
    message:
      state.status === "finished"
        ? "The inbox has already been processed. Showing the saved results."
        : "The agent is already working through the inbox. Showing its progress.",
  };
}
