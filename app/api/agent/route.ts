// POST /api/agent  { "source_file_id": 10, "run_id": "<from POST /api/run>" }
// Runs the quote agent on one file and streams its progress back as NDJSON:
// one AgentEvent (lib/agent/events.ts) per line – start, step…, finish | error.
//
// Refused with 409 (JSON { error }) when the caller doesn't own the current
// run, or the file isn't waiting – so no file is ever processed twice.
import { z } from "zod";
import type { AgentEvent } from "@/lib/agent/events";
import { runAgent } from "@/lib/agent/run";
import {
  claimSourceFile,
  demoRunStatusFor,
  finishDemoRunIfComplete,
  getSourceFile,
  touchDemoRun,
} from "@/lib/db";

// Vercel (Fluid compute): 300s is the Hobby maximum and the Pro default.
export const maxDuration = 300;

const Body = z.object({
  source_file_id: z.number().int().positive(),
  run_id: z.string().optional(),
});

const refuse = (error: string, status = 409) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return refuse('Send a JSON body like { "source_file_id": 10, "run_id": "…" }.', 400);
  }
  const { source_file_id: fileId, run_id: runId } = parsed.data;

  const file = await getSourceFile(fileId);
  if (!file) return refuse("That file couldn't be found.", 404);

  // Inbox files (and the held-back file) belong to the shared run: only the
  // browser that started it may send them. Uploads are processed on their own.
  if (!file.is_upload) {
    const runStatus = runId ? await demoRunStatusFor(runId) : null;
    const allowed =
      runStatus === "running" || (runStatus === "finished" && file.is_held_back);
    if (!allowed) {
      return refuse(
        runStatus === "finished"
          ? "The inbox has already been processed."
          : "This file is part of the shared inbox run. Press Process inbox to start or follow it.",
      );
    }
  }

  // waiting → working in one statement; anything else means it's taken.
  const claim = await claimSourceFile(file.id);
  if (claim === "earlier_file_pending") {
    return refuse(
      `${file.file_name} has to wait: an earlier quote from ${file.supplier_name} hasn't been processed yet.`,
    );
  }
  if (claim === "not_waiting") {
    // Re-read: the status may have changed since `file` was loaded.
    const now = await getSourceFile(file.id);
    return refuse(
      now?.status === "working"
        ? `${file.file_name} is already being processed.`
        : `${file.file_name} has already been processed.`,
    );
  }
  if (runId) await touchDemoRun(runId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The browser went away; the agent still finishes and saves its work.
        }
      };
      await runAgent(file.id, emit);
      if (runId) {
        await touchDemoRun(runId).catch(() => {});
        await finishDemoRunIfComplete().catch(() => {});
      }
      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
