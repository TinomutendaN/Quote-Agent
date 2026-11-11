// TEMPORARY – Step 1 smoke test only. Delete this route before the demo goes live.
// GET /api/test-ai sends one short message and returns the provider and reply.
import { generateText } from "ai";
import { connection } from "next/server";
import { getModel, getProvider } from "@/lib/ai/model";

export async function GET() {
  // Run at request time only, never prerendered at build time.
  await connection();

  const provider = getProvider();
  try {
    const { text } = await generateText({
      model: getModel(),
      prompt: "Reply with one short sentence confirming you are working.",
    });
    return Response.json({ provider, reply: text });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ provider, error: message }, { status: 500 });
  }
}
