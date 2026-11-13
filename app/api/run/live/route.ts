// GET /api/run/live[?run_id=…]
// Read-only: everything the Agent run screen shows, straight from the
// database (run state, files, saved lines, review items, events). Every
// visitor's screen, the driver's included, is built from this.
// With run_id, also says whether that token still owns the run (you_drive),
// so a driver who reloads gets Pause / Resume back. The token is never sent.
import { connection } from "next/server";
import { demoRunStatusFor, getRunSnapshot } from "@/lib/db";

export async function GET(request: Request) {
  await connection();
  try {
    const runId = new URL(request.url).searchParams.get("run_id");
    const [snapshot, ownStatus] = await Promise.all([
      getRunSnapshot(),
      runId ? demoRunStatusFor(runId) : Promise.resolve(null),
    ]);
    return Response.json(
      { ...snapshot, you_drive: ownStatus !== null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[run/live] failed:", error);
    return Response.json(
      { error: "Couldn't load the agent's progress – trying again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
