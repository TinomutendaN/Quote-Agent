// The shared "Process inbox" run.
//   GET  /api/run  → current state (status, times, inbox file counts)
//   POST /api/run  → start the run. Exactly one caller gets
//                    { started: true, run_id }; everyone else gets
//                    { started: false, state, message }. A run with no activity
//                    for 10 minutes is taken over by the next start.
import { connection } from "next/server";
import { startDemoRun } from "@/lib/agent/demo-run";
import { getDemoRun } from "@/lib/db";

export async function GET() {
  await connection();
  return Response.json(await getDemoRun());
}

export async function POST() {
  await connection();
  try {
    return Response.json(await startDemoRun());
  } catch (error) {
    console.error("[run] start failed:", error);
    return Response.json(
      { error: "Something went wrong starting the agent – try again." },
      { status: 500 },
    );
  }
}
