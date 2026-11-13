// POST /api/ask  { messages: UIMessage[] }   (sent by useChat on the Ask screen)
// Streams one answer. The model gets the system prompt, the last few turns as
// plain text, and three read-only tools (lib/ask/tools.ts). At most 6 tool
// steps: step 7 has its tools turned off so it always ends with an answer.
import { type UIMessage, isStepCount, streamText } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/model";
import { ASK_INSTRUCTIONS, type AskMetadata, MAX_QUESTION_LENGTH } from "@/lib/ask/prompt";
import { createAskTools } from "@/lib/ask/tools";

export const maxDuration = 60;

/** Earlier turns sent to the model with each question (text only). */
const HISTORY_TURNS = 4;
const MAX_TOOL_STEPS = 6;

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        parts: z.array(z.looseObject({ type: z.string() })),
      }).loose(),
    )
    .min(1)
    .max(200),
});

const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });

/** The plain text of a UI message. */
function textOf(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .map((p) => (p.type === "text" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
    .join("")
    .trim();
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Something went wrong sending your question – try again.", 400);

  const messages = parsed.data.messages as unknown as UIMessage[];
  const last = messages[messages.length - 1];
  const question = last.role === "user" ? textOf(last) : "";
  if (!question) return fail("Please type a question.", 400);
  if (question.length > MAX_QUESTION_LENGTH) {
    return fail(`Questions can be at most ${MAX_QUESTION_LENGTH} characters.`, 400);
  }

  // Earlier turns as text only: tool results from past answers aren't re-sent.
  const history = messages
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: textOf(m).slice(0, 2000) }))
    .filter((m) => m.content !== "")
    .slice(-HISTORY_TURNS * 2);

  try {
    const result = streamText({
      model: getModel(),
      instructions: ASK_INSTRUCTIONS,
      messages: [...history, { role: "user", content: question }],
      tools: createAskTools(),
      stopWhen: isStepCount(MAX_TOOL_STEPS + 1),
      prepareStep: ({ stepNumber }) => (stepNumber >= MAX_TOOL_STEPS ? { toolChoice: "none" } : undefined),
      abortSignal: request.signal,
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        if (part.type !== "finish") return undefined;
        const usage = part.totalUsage;
        return {
          input_tokens: usage.inputTokens ?? 0,
          output_tokens: usage.outputTokens ?? 0,
          cached_input_tokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        } satisfies AskMetadata;
      },
      onError: (error) => {
        console.error("[ask]", error);
        return "Something went wrong – try again.";
      },
    });
  } catch (error) {
    console.error("[ask]", error);
    return fail("Something went wrong – try again.", 500);
  }
}
