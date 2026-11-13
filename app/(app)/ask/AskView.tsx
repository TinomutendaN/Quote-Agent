"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { type AskMetadata, MAX_QUESTION_LENGTH } from "@/lib/ask/prompt";
import type { AskSource } from "@/lib/ask/tools";

type AskMessage = UIMessage<AskMetadata>;

const SUGGESTIONS = [
  "Which supplier is cheapest for Leeds?",
  "What changed since v2?",
  "Our margin on Specialist jobs?",
];

/** Chat history lives only in this browser tab. */
const STORAGE_KEY = "ask-chat";
/** Quotes shown under an answer before "Show all". */
const SOURCES_SHOWN = 5;

const ERROR_TEXT = "Something went wrong – try again.";

export function AskView() {
  const transport = useMemo(() => new DefaultChatTransport<AskMessage>({ api: "/api/ask" }), []);
  const { messages, sendMessage, setMessages, status, error, clearError } = useChat<AskMessage>({ transport });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  // Bring back this tab's chat (e.g. after "Review v4" and back).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved) as AskMessage[]);
    } catch {}
  }, [setMessages]);

  useEffect(() => {
    if (busy) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages, busy]);

  function ask(text: string) {
    const question = text.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!question || busy) return;
    clearError();
    setInput("");
    void sendMessage({ text: question });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    ask(input);
  }

  const last = messages[messages.length - 1];
  const thinking = busy && (!last || last.role === "user" || !hasText(last));
  const near = input.length >= MAX_QUESTION_LENGTH - 50;

  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-white p-[22px] shadow-card">
      {messages.length === 0 && (
        <p className="m-0 text-[15px] text-slate">
          Ask about the approved quotes, suppliers, routes and price list versions in this demo.
        </p>
      )}

      {messages.map((m) =>
        m.role === "user" ? (
          <div
            key={m.id}
            className="max-w-[85%] self-end rounded-[10px_10px_2px_10px] bg-ink px-4 py-3 text-[15px] break-words text-white sm:max-w-[75%]"
          >
            {textOf(m)}
          </div>
        ) : (
          <Answer key={m.id} message={m} />
        ),
      )}

      {thinking && (
        <p role="status" className="m-0 text-[15px] text-slate">
          Looking at your quotes…
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-[15px] text-on-salmon">
          {ERROR_TEXT}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => ask(s)}
            className="min-h-11 cursor-pointer rounded-full border border-line-strong bg-white px-3.5 text-left text-sm text-ink hover:bg-well disabled:cursor-wait disabled:opacity-70"
          >
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-1">
        <div className="flex gap-2">
          <label htmlFor="ask" className="sr-only">
            Ask a question
          </label>
          <input
            id="ask"
            type="text"
            value={input}
            maxLength={MAX_QUESTION_LENGTH}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about your quotes and prices…"
            autoComplete="off"
            className="min-h-12 min-w-0 flex-1 rounded-btn border border-line-strong bg-white px-4 text-[15px] text-ink"
          />
          <button
            type="submit"
            disabled={busy || input.trim() === ""}
            className="min-h-12 cursor-pointer rounded-btn border-0 bg-primary px-5 text-[13px] font-semibold tracking-[0.03em] text-white hover:bg-primary-hover disabled:cursor-default disabled:opacity-60"
          >
            ASK
          </button>
        </div>
        {near && (
          <span className="self-end text-xs text-muted">
            {input.length}/{MAX_QUESTION_LENGTH}
          </span>
        )}
      </form>
    </article>
  );
}

// ---------------------------------------------------------------------------
// One answer: tool chips, the text, then Quotes used (built from tool results)
// ---------------------------------------------------------------------------

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: Record<string, unknown>;
  output?: { sources?: AskSource[]; lists?: string[] };
};

const toolParts = (m: AskMessage) =>
  m.parts.filter((p) => p.type.startsWith("tool-")) as unknown as ToolPart[];

function Answer({ message }: { message: AskMessage }) {
  const tools = toolParts(message);
  const { sources, lists } = useMemo(() => {
    const byId = new Map<number, AskSource>();
    const names: string[] = [];
    for (const t of tools) {
      if (t.state !== "output-available" || !t.output) continue;
      for (const s of t.output.sources ?? []) if (!byId.has(s.id)) byId.set(s.id, s);
      for (const l of t.output.lists ?? []) if (!names.includes(l)) names.push(l);
    }
    return { sources: [...byId.values()], lists: names };
  }, [tools]);
  const text = textOf(message);

  return (
    <div className="flex flex-col gap-3">
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <span key={t.toolCallId} className="contents">
              <Chip>{t.type.slice("tool-".length)}</Chip>
              {Object.entries(t.input ?? {})
                .filter(([, v]) => v !== undefined && v !== null && v !== "")
                .map(([k, v]) => (
                  <Chip key={k}>
                    {k}: {String(v)}
                  </Chip>
                ))}
            </span>
          ))}
        </div>
      )}
      <div className="flex max-w-[640px] flex-col gap-3">
        {text && <Formatted text={text} />}
        {sources.length > 0 && <QuotesUsed sources={sources} />}
        {lists.length > 0 && (
          <p className="m-0 text-sm text-slate">From price lists: {lists.join(" and ")}</p>
        )}
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[3px] bg-nav-active px-[7px] py-[3px] font-mono text-[11px] break-all">{children}</span>
  );
}

function QuotesUsed({ sources }: { sources: AskSource[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, SOURCES_SHOWN);
  return (
    <section className="flex flex-col gap-2.5">
      <span className="text-xs font-semibold tracking-[0.04em] text-slate">QUOTES USED</span>
      {shown.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border-b border-line-soft pb-2.5">
          <span
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-bold"
            style={{ background: s.colour }}
          >
            {s.initials}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
            <strong className="font-semibold">{s.supplier}</strong>
            <span className="text-[13px] text-muted">{s.detail}</span>
          </div>
          {s.href ? (
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-[13px] font-semibold tracking-[0.03em] no-underline"
            >
              OPEN
            </a>
          ) : (
            <span className="text-xs text-muted">Upload – original not kept</span>
          )}
        </div>
      ))}
      {sources.length > SOURCES_SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="min-h-11 cursor-pointer self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-primary hover:text-primary-hover"
        >
          {all ? "Show fewer" : `Show all ${sources.length}`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Text helpers: paragraphs, "- " lists and **bold** – nothing else.
// ---------------------------------------------------------------------------

function textOf(m: AskMessage): string {
  return m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

const hasText = (m: AskMessage) => textOf(m) !== "";

function Formatted({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const item = /^[-*•]\s+/.test(line);
    const current = blocks[blocks.length - 1];
    if (current && current.lines.length > 0 && current.list === item) current.lines.push(line.replace(/^[-*•]\s+/, ""));
    else blocks.push({ list: item, lines: [line.replace(/^[-*•]\s+/, "")] });
  }
  return (
    <>
      {blocks
        .filter((b) => b.lines.length > 0)
        .map((b, i) =>
          b.list ? (
            <ul key={i} className="m-0 flex flex-col gap-1 pl-5 text-[16px] leading-[1.55]">
              {b.lines.map((l, j) => (
                <li key={j}>{bold(l)}</li>
              ))}
            </ul>
          ) : (
            <p key={i} className="m-0 text-[16px] leading-[1.55]">
              {b.lines.map((l, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {bold(l)}
                </span>
              ))}
            </p>
          ),
        )}
    </>
  );
}

function bold(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}
