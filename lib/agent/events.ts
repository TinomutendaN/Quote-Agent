// Events streamed back by /api/agent as NDJSON (one JSON object per line).
// Shared by the route, the test script and (Step 6) the Agent run screen, so
// this file has no server-only imports.

export type AgentToolName =
  | "read_file"
  | "save_quote_line"
  | "apply_rules"
  | "compare_history"
  | "check_duplicates"
  | "flag_for_review";

export type AgentStartEvent = {
  type: "start";
  file_id: number;
  file_name: string;
  at: string;
};

export type AgentStepEvent = {
  type: "step";
  file_id: number;
  file_name: string;
  /** 1 = read_file, then one per tool call in the order they finish. */
  step: number;
  tool: AgentToolName;
  /** Plain-English line written by our code (not the model). */
  text: string;
  /** Time since the previous step ended: the model's reading/thinking plus the tool. */
  duration_ms: number;
  /** false when the tool refused the call (e.g. unknown line id). */
  ok: boolean;
  at: string;
};

export type AgentFinishEvent = {
  type: "finish";
  file_id: number;
  file_name: string;
  status: "done" | "needs_review";
  lines_saved: number;
  review_items: number;
  /** Model steps used (each can hold several tool calls). */
  model_steps: number;
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number };
  duration_ms: number;
  /** The model's one-sentence summary. */
  summary: string;
};

export type AgentErrorEvent = {
  type: "error";
  file_id: number;
  file_name: string | null;
  /** Plain-English message for the screen. */
  message: string;
  /** Technical detail for logs and the test script. */
  detail: string;
};

export type AgentEvent = AgentStartEvent | AgentStepEvent | AgentFinishEvent | AgentErrorEvent;
