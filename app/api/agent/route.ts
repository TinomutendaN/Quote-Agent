// POST /api/agent  { "source_file_id": 10 }
// Runs the quote agent on one file and streams its progress back as NDJSON:
// one AgentEvent (lib/agent/events.ts) per line – start, step…, finish | error.
import { z } from "zod";
import type { AgentEvent } from "@/lib/agent/events";
import { runAgent } from "@/lib/agent/run";

// Vercel (Fluid compute): 300s is the Hobby maximum and the Pro default.
export const maxDuration = 300;

const Body = z.object({ source_file_id: z.number().int().positive() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Send a JSON body like { \"source_file_id\": 10 }." },
      { status: 400 },
    );
  }

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
      await runAgent(parsed.data.source_file_id, emit);
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
