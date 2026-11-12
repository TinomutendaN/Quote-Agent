// The five agent tools. Each one runs a fixed, parameterised query from
// lib/db.ts; the model never writes SQL. Every call is timed, written to
// agent_events with a plain-English line, and streamed to the caller.
import { tool } from "ai";
import { z } from "zod";
import {
  type Category,
  type QuoteLine,
  type SourceFile,
  fileReceivedLabel,
  findDuplicateLines,
  getFileQuoteLine,
  insertAgentEvent,
  insertQuoteLine,
  insertReviewItem,
  pastPricesForRoute,
  setQuoteLineCategory,
} from "@/lib/db";
import type { AgentStepEvent, AgentToolName } from "./events";

const money = (value: number | string) =>
  `£${Number(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const REASON_LABEL = {
  price_wrong: "price looks wrong",
  duplicate: "possible duplicate",
  unclear: "unclear quote",
  unknown_sender: "unknown sender",
} as const;

const RULE_FOR_CATEGORY: Record<Category, number> = {
  "Out-of-hours": 1,
  Specialist: 2,
  Standard: 3,
};

/** Numbers steps, times them and logs them. One per agent run (one file). */
export class StepLog {
  private step = 0;
  private lastEnd = Date.now();
  private pending: Promise<void>[] = [];

  constructor(
    private file: SourceFile,
    private emit: (event: AgentStepEvent) => void,
  ) {}

  record(tool: AgentToolName, text: string, ok = true): void {
    const now = Date.now();
    const event: AgentStepEvent = {
      type: "step",
      file_id: this.file.id,
      file_name: this.file.file_name,
      step: ++this.step,
      tool,
      text,
      duration_ms: now - this.lastEnd,
      ok,
      at: new Date(now).toISOString(),
    };
    this.lastEnd = now;
    this.emit(event);
    this.pending.push(
      insertAgentEvent({
        sourceFileId: this.file.id,
        stepNumber: event.step,
        toolName: tool,
        text,
        durationMs: event.duration_ms,
      }),
    );
  }

  /** Waits until every event has been written to the database. */
  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }
}

type ToolResult = Record<string, unknown>;

/** Runs a tool body and logs its plain-English line; failures go back to the model. */
async function logged(
  log: StepLog,
  name: AgentToolName,
  body: () => Promise<{ result: ToolResult; text: string }>,
): Promise<ToolResult> {
  try {
    const { result, text } = await body();
    log.record(name, text, !("error" in result));
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.record(name, `Could not complete this step: ${detail}`, false);
    return { error: detail };
  }
}

function refuse(text: string, error: string) {
  return { result: { error }, text };
}

export function createAgentTools(file: SourceFile, log: StepLog) {
  const lineOrRefuse = async (id: number): Promise<QuoteLine | null> =>
    getFileQuoteLine(id, file.id);

  return {
    save_quote_line: tool({
      description:
        "Store one extracted price from this quote. Call once per price line. Returns the quote_line_id used by the other tools.",
      inputSchema: z.object({
        route: z.string().min(3).describe('"Origin → Destination" with full place names'),
        price: z.number().positive().describe("Price in pounds, excluding VAT"),
        unit_note: z.string().describe('e.g. "per job", "per pallet", "total for 2 pallets"'),
        vat_note: z.string().describe('e.g. "ex VAT", or how VAT was removed'),
        time_slot: z.enum(["weekday", "evening", "overnight", "weekend"]),
        goods: z.enum(["general", "chilled_medical", "fragile", "secure"]),
        quote_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .describe("Date on the quote as YYYY-MM-DD, or null if none"),
      }),
      execute: (input) =>
        logged(log, "save_quote_line", async () => {
          const line = await insertQuoteLine({
            sourceFileId: file.id,
            supplierId: file.supplier_id,
            route: input.route,
            price: input.price,
            unitNote: input.unit_note,
            vatNote: input.vat_note,
            timeSlot: input.time_slot,
            goods: input.goods,
            quoteDate: input.quote_date,
          });
          return {
            result: { quote_line_id: line.id, route: line.route, price: Number(line.price) },
            text: `Saved ${line.route} at ${money(line.price)} ${input.unit_note}, ${input.vat_note}`,
          };
        }),
    }),

    apply_rules: tool({
      description:
        "Record the category for a saved line and the number of the rule that decided it (1 = Out-of-hours, 2 = Specialist, 3 = Standard).",
      inputSchema: z.object({
        quote_line_id: z.number().int(),
        category: z.enum(["Standard", "Out-of-hours", "Specialist"]),
        rule_number: z.number().int().min(1).max(3),
        reason: z.string().describe("A few words on why, e.g. 'Saturday collection'"),
      }),
      execute: (input) =>
        logged(log, "apply_rules", async () => {
          const line = await lineOrRefuse(input.quote_line_id);
          if (!line) {
            return refuse(
              `Could not sort line ${input.quote_line_id}: not saved from this file`,
              "No line with that quote_line_id was saved from this file.",
            );
          }
          if (RULE_FOR_CATEGORY[input.category] !== input.rule_number) {
            return refuse(
              `Could not sort ${line.route}: category and rule don't match`,
              `${input.category} is decided by rule ${RULE_FOR_CATEGORY[input.category]}, not rule ${input.rule_number}.`,
            );
          }
          if (line.goods !== "general" && input.category !== "Specialist") {
            return refuse(
              `Could not sort ${line.route} as ${input.category}: the goods are ${line.goods}`,
              `This line was saved with goods "${line.goods}", so rule 2 makes it Specialist (rule 2 wins over rule 1).`,
            );
          }
          if (line.goods === "general" && line.time_slot !== "weekday" && input.category !== "Out-of-hours") {
            return refuse(
              `Could not sort ${line.route} as ${input.category}: it runs ${line.time_slot}`,
              `This line was saved with time_slot "${line.time_slot}" and general goods, so rule 1 makes it Out-of-hours.`,
            );
          }
          if (line.goods === "general" && line.time_slot === "weekday" && input.category !== "Standard") {
            return refuse(
              `Could not sort ${line.route} as ${input.category}: weekday, general goods`,
              `This line was saved as a weekday job with general goods, so rule 3 makes it Standard. If that is wrong, save the line again with the right time_slot or goods.`,
            );
          }
          await setQuoteLineCategory(line.id, file.id, input.category, input.rule_number);
          return {
            result: { quote_line_id: line.id, category: input.category, rule_number: input.rule_number },
            text: `Sorted ${line.route} as ${input.category} (rule ${input.rule_number}: ${input.reason})`,
          };
        }),
    }),

    compare_history: tool({
      description:
        "Look up the usual price for a saved line's route and category from past approved prices (rule 4). Call after apply_rules. over_limit = true means the price is more than 50% above usual.",
      inputSchema: z.object({ quote_line_id: z.number().int() }),
      execute: (input) =>
        logged(log, "compare_history", async () => {
          const line = await lineOrRefuse(input.quote_line_id);
          if (!line) {
            return refuse(
              `Could not compare line ${input.quote_line_id}: not saved from this file`,
              "No line with that quote_line_id was saved from this file.",
            );
          }
          if (!line.category) {
            return refuse(
              `Could not compare ${line.route}: not sorted yet`,
              "Call apply_rules for this line first.",
            );
          }
          const past = await pastPricesForRoute(line.route, line.category);
          if (past.length === 0) {
            return {
              result: { quote_line_id: line.id, usual_price: null, past_quotes: [], over_limit: false },
              text: `No past prices for ${line.route} (${line.category}) to compare with`,
            };
          }
          const usual =
            Math.round((past.reduce((sum, p) => sum + Number(p.price), 0) / past.length) * 100) / 100;
          const price = Number(line.price);
          const pctAbove = Math.round((price / usual - 1) * 100);
          const overLimit = price > usual * 1.5;
          const diff =
            pctAbove > 0 ? `${pctAbove}% higher` : pctAbove < 0 ? `${-pctAbove}% lower` : "the same";
          return {
            result: {
              quote_line_id: line.id,
              usual_price: usual,
              past_quotes: past,
              pct_above_usual: pctAbove,
              over_limit: overLimit,
            },
            text: `${line.route} is usually ${money(usual)} (${past.length} past ${past.length === 1 ? "quote" : "quotes"}) – ${money(price)} is ${diff}${overLimit ? ", more than 50% above usual" : ""}`,
          };
        }),
    }),

    check_duplicates: tool({
      description:
        "Check whether this supplier already quoted the same job (same route, category, time slot and goods) in another file in this batch at a different price. Past prices are never checked. Call after apply_rules.",
      inputSchema: z.object({ quote_line_id: z.number().int() }),
      execute: (input) =>
        logged(log, "check_duplicates", async () => {
          const line = await lineOrRefuse(input.quote_line_id);
          if (!line) {
            return refuse(
              `Could not check line ${input.quote_line_id}: not saved from this file`,
              "No line with that quote_line_id was saved from this file.",
            );
          }
          if (!line.category) {
            return refuse(
              `Could not check ${line.route}: not sorted yet`,
              "Call apply_rules for this line first.",
            );
          }
          if (line.supplier_id === null) {
            return {
              result: { quote_line_id: line.id, matches: [], note: "Supplier unknown, nothing to compare." },
              text: `Skipped duplicate check for ${line.route}: supplier unknown`,
            };
          }
          const matches = await findDuplicateLines(line);
          const thisReceived = await fileReceivedLabel(file.id);
          if (matches.length === 0) {
            return {
              result: { quote_line_id: line.id, matches: [] },
              text: `No other quote for ${line.route} (${line.category}) from this supplier`,
            };
          }
          const first = matches[0];
          return {
            result: {
              quote_line_id: line.id,
              this_price: Number(line.price),
              this_file_received: thisReceived,
              matches: matches.map((m) => ({
                quote_line_id: m.id,
                price: Number(m.price),
                file_name: m.file_name,
                received: m.received,
              })),
            },
            text: `Same job already quoted at ${money(first.price)} in ${first.file_name} (${first.received}); this quote says ${money(line.price)}`,
          };
        }),
    }),

    flag_for_review: tool({
      description:
        "Send something to the person's review queue instead of guessing. Use reason price_wrong, duplicate or unclear for one line (give quote_line_id), or unknown_sender once for the whole file (no quote_line_id).",
      inputSchema: z.object({
        reason_type: z.enum(["price_wrong", "duplicate", "unclear", "unknown_sender"]),
        quote_line_id: z.number().int().nullable().describe("The line, or null for the whole file"),
        reason_text: z.string().describe("Short plain-English reason"),
        original_excerpt: z.string().describe("The exact original text from the quote"),
        usual_price: z.number().nullable().describe("Usual price if known, else null"),
        suggestion: z.string().describe("One concrete suggested fix"),
      }),
      execute: (input) =>
        logged(log, "flag_for_review", async () => {
          let line: QuoteLine | null = null;
          if (input.quote_line_id !== null) {
            line = await lineOrRefuse(input.quote_line_id);
            if (!line) {
              return refuse(
                `Could not flag line ${input.quote_line_id}: not saved from this file`,
                "No line with that quote_line_id was saved from this file.",
              );
            }
          } else if (input.reason_type !== "unknown_sender") {
            return refuse(
              `Could not flag: ${REASON_LABEL[input.reason_type]} needs a line`,
              `Reason ${input.reason_type} must name the quote_line_id it is about.`,
            );
          }
          const id = await insertReviewItem({
            sourceFileId: file.id,
            quoteLineId: line?.id ?? null,
            reasonType: input.reason_type,
            reasonText: input.reason_text,
            originalExcerpt: input.original_excerpt,
            usualPrice: input.usual_price,
            suggestion: input.suggestion,
          });
          const what = line ? ` – ${line.route} ${money(line.price)}` : "";
          if (id === null) {
            return {
              result: { review_item_id: null, note: "Already flagged for this reason." },
              text: `Already in review: ${REASON_LABEL[input.reason_type]}${what}`,
            };
          }
          return {
            result: { review_item_id: id },
            text: `Sent to review: ${REASON_LABEL[input.reason_type]}${what}`,
          };
        }),
    }),
  };
}
