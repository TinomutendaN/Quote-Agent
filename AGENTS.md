# AGENTS.md

## App name

Quote Agent

## One-line description

Quote Agent is an AI agent that reads messy supplier quotes (emails, PDFs, scans and spreadsheets), sorts every job using the business's own plain-English rules, stops for human approval on anything odd, and turns the approved data into customer and internal price lists.

## Core features

- **Landing:** One-line promise, a before/after example of a messy quote turned into clean prices, a "Try the demo" button that opens the Inbox with sample data, and a "Tutorial video" button. No signup.
- **Inbox:** 17 sample quotes from a fictional courier company (Northline Couriers): 5 emails, 7 PDFs (including an office scan, a phone photo of a handwritten quote pad and a fax) and 5 spreadsheets. Grouped by supplier, filterable by type (emails, PDFs, spreadsheets), with each supplier's past prices. The business's sorting rules are shown in plain English (read-only). "Process inbox" starts the agent; "Add quotes" lets a visitor upload their own small file, which is processed straight away.
- **Agent run:** The agent works through each quote on its own, choosing its steps per file (read, extract, compare with past prices, sort by rules). A live "What the agent is doing" panel explains each decision in plain language, and progress bars show ready, needs-you and still-working counts. Visitors can pause the run, see every extracted price, and read the full activity log.
- **Review queue:** Anything the agent wasn't sure about (prices that look wrong, duplicates, unclear quotes, unknown senders) waits here, filterable by reason, with the original text, past prices and a suggested fix. Nothing reaches a price list until a person approves, edits or rejects it.
- **Price lists:** Built from the cheapest approved quote for each route and service. Set a markup (with extra points for out-of-hours and specialist jobs), switch between customer and internal lists showing cost, markup and margin, save versions, compare versions and export a PDF.
- **Ask:** Plain-English questions about quotes, prices, margins and version changes (for example "What's our typical cost for London to Manchester?"), answered from approved data and showing which quotes were used. After the inbox is processed, a new supplier quote arrives automatically, is handled by the agent and creates a draft price list waiting for approval.

## Tech stack

Single Next.js app deployed on Vercel. Runtime dependencies capped at 10.

| Area | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Agent layer | Vercel AI SDK: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/react` |
| Model | Switchable with one setting (`AI_PROVIDER`). OpenAI for building and testing; Claude Sonnet 5.5 (`claude-sonnet-5-5`) available as the backend option |
| Reading PDFs and scans | Sent directly to the model as document/image blocks (no PDF or text-recognition library). Test this on both providers early |
| Spreadsheets | SheetJS (`xlsx`): convert sheets to CSV text, then send to the model |
| Database | Neon Postgres (via the Vercel Marketplace) with `@neondatabase/serverless` and plain SQL from one `schema.sql` (no ORM) |
| Validation | Zod (tool inputs and extracted quote data) |
| Styling | Tailwind CSS (dev dependency) |
| PDF export | Browser print with a print stylesheet ("Save as PDF") |
| File storage | None. Sample quotes live in `public/samples/` (answer key in `public/samples/README.md`); uploads go straight to the agent and only extracted data is saved |

Runtime dependencies (10): `next`, `react`, `react-dom`, `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/react`, `zod`, `@neondatabase/serverless`, `xlsx`.

Model settings (environment variables):

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `openai` (default while building) or `anthropic` |
| `OPENAI_API_KEY` | OpenAI key |
| `OPENAI_MODEL` | OpenAI model name (choose a current model that supports tool calling and image/PDF input) |
| `ANTHROPIC_API_KEY` | Anthropic key |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` |

Stack notes:

- All model calls go through one helper, `lib/ai/model.ts`, which reads `AI_PROVIDER` and returns the right model. No other file imports a provider package directly.
- Install SheetJS from its CDN, not the npm registry (the npm copy is outdated): `npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- Run the agent one quote per request: the browser sends each file to `/api/agent` in turn. This keeps serverless calls short and makes the activity panel fill in quote by quote. Set `maxDuration` on the route after checking Vercel's current function limits.
- Agent tools are database actions; the model does the reading itself: `save_quote_line`, `apply_rules`, `compare_history`, `check_duplicates`, `flag_for_review`.
- Ask tools are read-only: `query_approved_quotes`, `get_price_list`, `compare_versions`.
- Price list rule: for each route and service, use the cheapest approved quote.
- Demo protections: "Process inbox" runs the sample inbox only once per reset (later presses show saved results); "Reset demo" (sidebar footer) restores the fresh sample data. All visitors share one demo database.
- Out of scope for the demo: login, real email forwarding, multiple companies, editing rules, saved answers, sorting.
