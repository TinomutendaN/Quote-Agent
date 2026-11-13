// Runs the quote agent on one source file: read → loop of tool calls → status.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isStepCount, streamText } from "ai";
import { getModel, getProvider } from "@/lib/ai/model";
import {
  clearFileResults,
  countFileResults,
  getSourceFile,
  listRules,
  setSourceFileStatus,
  type SourceFile,
} from "@/lib/db";
import { displayFileName } from "@/lib/fileNames";
import { convertFile } from "./convert";
import type { AgentEvent } from "./events";
import { buildInstructions } from "./prompt";
import { StepLog, createAgentTools } from "./tools";

/** Most model steps per file. Each step can hold many parallel tool calls. */
export const MAX_MODEL_STEPS = 40;

const READ_ERROR = "Something went wrong reading this file – try again.";

class AgentError extends Error {
  constructor(
    public userMessage: string,
    detail: string,
  ) {
    super(detail);
  }
}

async function loadSampleBytes(file: SourceFile): Promise<Uint8Array> {
  if (!file.file_path) {
    throw new AgentError(
      "The original of this file isn't kept, so it can't be processed again.",
      `source_files.${file.id} has no file_path`,
    );
  }
  // file_path is like "/samples/10_quote_scan_0031.pdf"; only public/samples is allowed.
  const name = path.basename(file.file_path);
  return new Uint8Array(await readFile(path.join(process.cwd(), "public", "samples", name)));
}

/**
 * Processes one file and reports progress through `emit`. The caller must
 * already have claimed the file (claimSourceFile: waiting → working). Never
 * throws: failures become an "error" event and the file goes back to
 * "waiting". `bytes` lets uploads (Step 6) pass content that isn't on disk.
 */
export async function runAgent(
  fileId: number,
  emit: (event: AgentEvent) => void,
  options: { bytes?: Uint8Array; signal?: AbortSignal } = {},
): Promise<void> {
  const started = Date.now();
  let file: SourceFile | null = null;

  try {
    file = await getSourceFile(fileId);
    if (!file) throw new AgentError("That file couldn't be found.", `No source_files row ${fileId}`);

    // Leftovers from an earlier failed attempt, if any.
    await clearFileResults(file.id);
    emit({ type: "start", file_id: file.id, file_name: file.file_name, at: new Date().toISOString() });

    const log = new StepLog(file, emit);
    const bytes = options.bytes ?? (await loadSampleBytes(file));
    const converted = convertFile(bytes, file.file_name, file.type, getProvider());
    log.record("read_file", `Opened ${displayFileName(file)} (${converted.description})`);

    const rules = await listRules();
    const result = streamText({
      model: getModel(),
      instructions: buildInstructions(file, rules),
      messages: [
        {
          role: "user",
          content: [
            ...converted.content,
            { type: "text", text: "Process this quote now, following the workflow." },
          ],
        },
      ],
      tools: createAgentTools(file, log),
      stopWhen: isStepCount(MAX_MODEL_STEPS),
      abortSignal: options.signal,
    });

    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error;
    }

    const [steps, finishReason, usage, text] = await Promise.all([
      result.steps,
      result.finishReason,
      result.totalUsage,
      result.text,
    ]);
    await log.flush();

    // Stopped by the step limit while the model still wanted to call tools.
    if (finishReason === "tool-calls") {
      throw new AgentError(
        "The agent ran out of steps before finishing this file – try again.",
        `Hit the ${MAX_MODEL_STEPS}-step limit after ${steps.length} model steps`,
      );
    }
    if (finishReason !== "stop") {
      throw new AgentError(READ_ERROR, `Model finished with reason "${finishReason}"`);
    }

    const counts = await countFileResults(file.id);
    const status = counts.reviews > 0 ? "needs_review" : "done";
    await setSourceFileStatus(file.id, status);

    emit({
      type: "finish",
      file_id: file.id,
      file_name: file.file_name,
      status,
      lines_saved: counts.lines,
      review_items: counts.reviews,
      model_steps: steps.length,
      usage: {
        input_tokens: usage.inputTokens ?? 0,
        output_tokens: usage.outputTokens ?? 0,
        cached_input_tokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
      },
      duration_ms: Date.now() - started,
      summary: text.trim(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[agent] file ${fileId}:`, detail);
    if (file) {
      const id = file.id;
      // No half-finished data: drop this run's lines and review items, keep its events.
      await clearFileResults(id, { keepEvents: true })
        .then(() => setSourceFileStatus(id, "waiting"))
        .catch(() => {});
    }
    emit({
      type: "error",
      file_id: fileId,
      file_name: file?.file_name ?? null,
      message: error instanceof AgentError ? error.userMessage : READ_ERROR,
      detail,
    });
  }
}
