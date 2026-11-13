// POST /api/reset  – Reset demo (sidebar footer).
// Rebuilds the shared database in one transaction (db/schema.sql + db/seed.sql,
// the same as npm run db:setup). Once today's run limit is reached it loads
// the saved earlier run instead (the same as npm run db:processed), so
// visitors can still use Review, Price lists and Ask.
//
// Refused, changing nothing:
//   429 – the demo was reset less than a minute ago (by anyone)
//   409 – someone is using the agent right now (a run, file 16 or an upload
//         with activity in the last 10 minutes)
import { connection } from "next/server";
import { STALL_MINUTES } from "@/lib/agent/demo-run";
import { getDailyUsage, resetDatabase } from "@/lib/db";
import { RESET_COOLDOWN_SECONDS, dailyLimit } from "@/lib/limits";

// A reset normally takes a few seconds.
export const maxDuration = 60;

const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });

export async function POST() {
  await connection();
  try {
    const usage = await getDailyUsage();
    const useSavedRun = usage.runs >= dailyLimit("runs");
    const result = await resetDatabase({
      mode: useSavedRun ? "processed" : "fresh",
      checks: { cooldownSeconds: RESET_COOLDOWN_SECONDS, stallMinutes: STALL_MINUTES },
      savedRun: useSavedRun,
    });
    if (!result.ok) {
      return result.reason === "cooldown"
        ? fail("The demo was just reset – try again in a minute.", 429)
        : fail("Someone is running the demo right now – try again in a few minutes.", 409);
    }
    return Response.json({ ok: true, mode: result.mode });
  } catch (error) {
    console.error("[reset] failed:", error);
    return fail("Something went wrong resetting the demo – try again.", 500);
  }
}
