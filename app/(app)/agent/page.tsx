import { Suspense } from "react";
import { SavedRunNote } from "@/components/SavedRunNote";
import { getRunSnapshot } from "@/lib/db";
import { AgentRunView } from "./AgentRunView";

// Agent run: built from the database for every visitor. The first snapshot is
// rendered here; the view then keeps itself up to date from /api/run/live.
export default function AgentPage() {
  return (
    <Suspense fallback={<p className="m-0 text-sm text-slate">Loading the agent run…</p>}>
      <AgentRunData />
    </Suspense>
  );
}

async function AgentRunData() {
  const snapshot = await getRunSnapshot();
  return (
    <AgentRunView
      initial={{ ...snapshot, you_drive: false }}
      note={
        <Suspense fallback={null}>
          <SavedRunNote />
        </Suspense>
      }
    />
  );
}
