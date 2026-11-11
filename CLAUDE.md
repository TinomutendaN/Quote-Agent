# CLAUDE.md – Quote Agent build guide

Quote Agent is a demo app: an AI agent that reads messy supplier quotes, sorts them with the business's rules, stops for human approval on anything odd, and builds price lists. See AGENTS.md for the feature list and tech stack.

Solo developer, 48-hour build, deployed on Vercel. Follow the steps in order. Each step lists what it needs, what to build, and how to know it's done. The canvas designs are the visual reference for every screen.

## Working rules

- Stay inside the agreed stack. Do not add a dependency without asking first. Runtime dependencies are capped at 10 (currently at 10).
- Match the canvas designs: sidebar with MAIN MENU and a "Reset demo" link in the footer, pastel status panels (salmon = needs you, sky blue = new/done, lavender = in progress, mint = active), uppercase tabs, dashed pills.
- Every visible button, tab and link must work. If something can't be built in time, remove it from the screen rather than leaving it dead.
- All UI text in plain English. No jargon on screen.
- The model does the reading. Do not add PDF parsers or text-recognition libraries.
- All model calls go through `lib/ai/model.ts`. No other file imports `@ai-sdk/openai` or `@ai-sdk/anthropic` directly. Build and test with `AI_PROVIDER=openai`; the app must also work unchanged with `AI_PROVIDER=anthropic`.
- Never let the model run free-form SQL. Every database action is a fixed, parameterised query in `lib/db.ts` behind a tool.
- Price and version logic lives in one place, `lib/pricing.ts`, and is reused by the Price lists screen and the Ask tools.
- When unsure about a requirement, ask instead of guessing.

## Decisions already made

- **Price list rule:** for each route and service (Standard, Out-of-hours, Specialist), use the cheapest approved quote.
- **Markup:** sell price = cost × (1 + markup). Standard uses the chosen markup (15, 25 or 35%, default 25%); Out-of-hours adds 10 points; Specialist adds 15 points.
- **Process inbox runs once per reset.** If the sample inbox has already been processed, the button shows the saved results instead of running again.
- **New quote moment is automatic.** When the last sample file finishes, the agent processes the held-back M6 Express email once and creates draft price list v4.
- **Reset demo** lives in the sidebar footer. All visitors share one database; reset restores the fresh sample data.
- **Rules are read-only** in the demo but stored in a `rules` table so editing can be added later.
- **Uploads ("Add quotes")** are processed immediately because files aren't stored. Keep upload size small and show a clear message if a file is too large or the wrong type.
- **Removed from the designs (do not build):** Sort and Filters, card Edit/More/Expand icons, supplier Contact tab, Edit rules tab, Saved answers, Automatic updates tab.

## Step 0 – Accounts and keys (30 min)

**Needs:** GitHub account, Vercel account, OpenAI API key (your existing credits), Anthropic API key, Node.js LTS installed.

**Build:** Set a monthly spending limit on both the OpenAI and Anthropic accounts so a public demo can't run up a big bill. Pick the OpenAI model you'll use: a current one that supports tool calling and image/PDF input.

**Done when:** You can log in to all four and have both API keys saved somewhere safe.

## Step 1 – Project setup and first deploy (1 hour)

**Needs:** Step 0.

**Build:**
- Create the app with `create-next-app` (TypeScript, App Router, Tailwind).
- Install runtime dependencies (10 total, at the cap): `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/react`, `zod`, `@neondatabase/serverless`, and SheetJS from its CDN: `npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- Folder layout:
  - `app/` – pages: `/` (Landing), `/inbox`, `/agent`, `/review`, `/pricing`, `/ask`
  - `app/api/agent/route.ts`, `app/api/ask/route.ts`, `app/api/upload/route.ts`, `app/api/reset/route.ts`
  - `lib/ai/model.ts` – reads `AI_PROVIDER` and returns the OpenAI or Claude model
  - `lib/db.ts` – database client and all SQL queries
  - `lib/pricing.ts` – price list building, markup maths, version comparison
  - `lib/agent/` – system prompt, tools, file converters
  - `components/` – sidebar, page header, card, status panel, colour strip, pill, tile, progress bar, tabs
  - `db/schema.sql`, `db/seed.sql`
  - `public/samples/` – the 17 sample quote files plus the held-back M6 Express email (from `quote-agent-samples.zip`)
- Add environment variables locally and on Vercel: `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-sonnet-5-5`.
- Write `lib/ai/model.ts` now: if `AI_PROVIDER` is `anthropic` return the Claude model, otherwise the OpenAI model.
- Push to GitHub and deploy to Vercel straight away, even though the app is empty.

**Done when:** An empty page loads on your Vercel URL, and a one-line test call returns a reply with `AI_PROVIDER=openai` and with `AI_PROVIDER=anthropic`.

## Step 2 – Database (1.5 hours)

**Needs:** Step 1.

**Build:**
- Add Neon from the Vercel Marketplace and connect it to the project. Run `vercel env pull` to get `DATABASE_URL` locally.
- `db/schema.sql` with these tables:
  - `suppliers` – id, name, colour (for initials circles)
  - `rules` – id, number, plain-English text
  - `source_files` – id, supplier_id (nullable for unknown sender), file name, file path in `public/samples` (empty for uploads), type (email, pdf, scan, spreadsheet), received time, is_held_back (for the new-quote moment), is_upload, status (waiting, working, done, needs review)
  - `quote_lines` – id, source_file_id, supplier_id, route, category (Standard, Out-of-hours, Specialist), price, unit note (e.g. per pallet), VAT note, quote date, status (pending, approved, rejected), is_history (seeded past prices)
  - `review_items` – id, quote_line_id or source_file_id, reason type (price looks wrong, duplicate, unclear, unknown sender), reason text, original text excerpt, usual price for the route, suggestion, status (open, approved, edited, rejected)
  - `agent_events` – id, source_file_id, step number, tool name, plain-English text, duration in milliseconds, time
  - `price_lists` – id, version number, label, status (draft, saved), markup settings, snapshot of rows (JSON), created time
- `db/seed.sql`: the five fictional suppliers, the five rules, the 17 source files plus the held-back one (names, types and received times from `public/samples/README.md`), **past approved prices for each route** (so `compare_history` has something to compare against, e.g. Leeds → Bristol usually about £160), and saved price lists v1 and v2 (so Versions and Compare have data before the first run).

**Done when:** Tables exist in Neon and the seed data shows in the Neon table editor.

## Step 3 – Sample quote files (30 min)

**Needs:** Step 2 (file names must match the seed data).

**Build:** The sample files are already made. Unzip `quote-agent-samples.zip` into `public/samples/`. `public/samples/README.md` is the answer key: every file, its supplier, type, received time, contents and the expected result. Use it for the seed data (Step 2) and for testing (Step 11).

What's in the set (fictional suppliers: Pennine Freight, Riverside Logistics, Swift Haul Ltd, M6 Express, Capital Same-Day):
- 5 emails (01–05) – casual wording, a price buried in a forwarded thread, "2 pallets £310 ex vat", a date only in the signature
- 7 PDFs:
  - 4 clean PDFs (06–09) – a 3-page tariff with a table split across pages, a 2-page quotation with a subtotal that is not a price, a specialist rate card, an evening supplement
  - 3 scans – an office scan from Riverside Logistics (10) with Leeds → Bristol clearly printed as £480.00, a colour phone photo of a handwritten Pennine Freight quote pad (17), and a noisy black-and-white Swift Haul fax (18)
- 5 spreadsheets (11–15) – title rows and an inc-VAT formula column, a bare CSV with no supplier name, two tabs (standard and out-of-hours), postcode areas instead of cities, zone-based prices with merged headers
- 1 held-back M6 Express email (16): London → Manchester £270 (cheaper than Swift Haul's £295)

The four review cases are built in on purpose:
- **Price looks wrong:** file 10, Leeds → Bristol £480 against a usual £160. Suggestion: check with the supplier.
- **Duplicate:** files 03 and 04, Saturday London → Manchester at £340 then £320. Suggestion: keep £320 from the later email.
- **Unclear:** file 01, "2 pallets £310". Suggestion: record £155 per pallet.
- **Unknown sender:** file 12. Suggestion: choose the supplier or reject the file.

**Done when:** All files open from `public/samples/`, and the seed data matches the README.

## Step 4 – App shell and static screens (3 hours)

**Needs:** Step 1. Can run in parallel with Steps 2–3.

**Build:**
- Shared components from the canvas: sidebar (Quote Agent logo, MAIN MENU, five menu items, Review queue badge, footer with "Northline Couriers · sample data" and a "Reset demo" link), page header (back/forward arrows using the browser's history, breadcrumb, action buttons, title, uppercase tabs), card with coloured left status panel, card with thin colour strip (Review queue), dashed pill, grey-pill tile, progress bar.
- All six pages with hard-coded data first, matching the canvas.

**Done when:** You can click through all six screens on Vercel, the back/forward arrows work, and the screens look like the canvas.

## Step 5 – The agent (6 hours – most important step)

**Needs:** Steps 2–4.

**Build `app/api/agent/route.ts`:**
- Input: one `source_file_id` (or an uploaded file's content, see Step 6). Processes one quote per request.
- Load the file and convert it by type:
  - PDF or scan → base64 document or image block (the model reads it directly). Test the scanned PDF on OpenAI first thing; if a provider can't take a file type directly, handle the conversion inside the file converter for that provider only
  - Spreadsheet → SheetJS → CSV text
  - Email → plain text
- System prompt: the goal ("turn this quote into clean, sorted price data"), the rules loaded from the `rules` table, and the instruction to flag anything uncertain instead of guessing.
- Tools (Zod inputs, each a fixed SQL query in `lib/db.ts`):
  - `save_quote_line` – store one extracted price
  - `apply_rules` – record the category and which rule decided it
  - `compare_history` – usual price for a route from past approved prices
  - `check_duplicates` – same supplier, route and service already in this batch at a different price (same price repeated is not a duplicate)
  - `flag_for_review` – create a review item with reason, original text excerpt, usual price and suggestion
- Log every tool call to `agent_events` automatically with a plain-English line and its duration.
- Get the model from `lib/ai/model.ts`. Use the AI SDK's streaming text call with tools and a step limit so the agent loops until done, then stream the result to the browser.
- Set `maxDuration` on the route after checking Vercel's current function limits.

**Done when:** Running the agent on the scanned PDF saves the line, compares it with history, and creates a "price looks wrong" review item, with each step and its duration in `agent_events`.

## Step 6 – Inbox and Agent run, live (4 hours)

**Needs:** Step 5.

**Inbox:**
- Supplier cards from `source_files`. Tile notes show "Not processed yet" before the run and the real count after (e.g. "2 prices found").
- Type tabs (All / Emails / PDFs / Spreadsheets) filter the cards; counts come from the database.
- Card tabs: Files (the tiles) and Supplier history (that supplier's past prices).
- Rules card reads from the `rules` table (read-only).
- "Process inbox": if the sample inbox is already processed, go to Agent run and show saved results; otherwise send files to `/api/agent` one after another from the browser.
- "Add quotes": `app/api/upload/route.ts` accepts one small file (email text, PDF, image, spreadsheet), creates a `source_files` row marked as an upload, and runs the agent on it immediately. Show clear errors for files that are too large or the wrong type.

**Agent run:**
- Each quote card fills its step tiles as tool calls stream in, with step times. Map tool names to plain-English titles (e.g. `compare_history` → "Compare with past prices").
- Card tabs: Steps (tiles), Result (prices saved from that file), Original file (opens the sample from `public/samples`; for uploads say the original isn't kept).
- "What the agent is doing" panel shows the current job and the latest events, newest on top.
- Page tabs: Live run (cards), Extracted data (table of all saved prices), Activity log (every event).
- Progress bars (Ready / Need you / Working) count from the database.
- End circle per card: "Sent to review", "Ready" or "In progress".
- "Pause agent" stops the browser queue after the current file finishes; the button changes to "Resume".
- When the last sample file finishes, automatically process the held-back M6 Express email once (see Step 9).

**Done when:** Pressing Process inbox shows the agent working through all 17 files live, ending with 4 items in review; pause and resume work; pressing Process inbox again shows saved results without a new run.

## Step 7 – Review queue (2 hours)

**Needs:** Step 5.

**Build:**
- List open review items with a colour strip by reason.
- Reason tabs (All / Price looks wrong / Duplicates / Unclear) filter the list.
- Card tabs: General (reason, details, suggestion), Original text (stored excerpt), Price history (usual price and past quotes for that route).
- Approve / Edit / Reject update `review_items` and the linked `quote_lines` status. Edit opens a small inline form for price, route and category.
- "Continue to pricing" goes to Price lists.
- Sidebar badge shows the live open count.

**Done when:** Approving all four items leaves the queue empty and the lines show as approved.

## Step 8 – Price lists (3 hours)

**Needs:** Step 7.

**Build in `lib/pricing.ts` (plain TypeScript, no AI):**
- Build rows: cheapest approved quote per route and service.
- Markup maths as set out in "Decisions already made".
- Compare two versions: added, removed and changed prices.

**Screen:**
- Markup buttons (15 / 25 / 35%), Customer and Internal tabs, totals and the margin vs cost bar.
- Page tabs: Current list, Versions (all saved versions, each can be opened), Compare (pick two versions, see what changed).
- "Save version" stores a snapshot in `price_lists`; saved versions also listed in the left panel.
- "Export PDF" uses a print stylesheet (hide sidebar and buttons) and the browser's Save as PDF.

**Done when:** Changing markup updates every number, a saved version can be reopened, Compare shows the right differences, and the printed PDF looks clean.

## Step 9 – Ask and the new-quote moment (3 hours)

**Needs:** Steps 5 and 8.

**Build:**
- `app/api/ask/route.ts`: the model from `lib/ai/model.ts` with three read-only tools that call `lib/db.ts` and `lib/pricing.ts`:
  - `query_approved_quotes` – filter by route, supplier, service
  - `get_price_list` – current or a given version, including margins
  - `compare_versions` – what changed between two versions
- Answers must list the quotes used. Each "Open" link opens the original file.
- Ask screen: chat, tool chips shown above each answer, "Quotes used" list, three suggested questions that send when clicked ("Which supplier is cheapest for Leeds?", "What changed since v2?", "Our margin on Specialist jobs?").
- New-quote card: shows the result of the automatic run on the held-back M6 Express email (from Step 6): price, comparison with Swift Haul, and a "Review v4" button that opens draft v4 in Price lists.

**Done when:** All three suggested questions return correct answers with sources, and the new-quote card links to a draft v4.

## Step 10 – Landing page and Reset demo (1.5 hours)

**Needs:** Step 4.

**Build:**
- Landing page as designed: "Try the demo" opens the Inbox, "Tutorial video" links to the recording (add the link in Step 12).
- `app/api/reset/route.ts`: clears processed data, uploads, review items, events and draft price lists, then reloads the seed. Wire it to the "Reset demo" link in the sidebar footer, with a short confirmation.

**Done when:** Reset returns the app to a fresh 17-quote inbox with v1 and v2 price lists.

## Step 11 – Test, polish and deploy (3 hours)

**Needs:** Steps 5–10.

**Build:**
- Full run-through on the live Vercel URL, three times, resetting in between.
- Click every button, tab and link on all six screens; nothing may be dead.
- Check results match `public/samples/README.md`: the same 4 review items every run, and files 17 (handwriting photo) and 18 (fax) read correctly. Tighten the system prompt if not.
- Repeat the full run with `AI_PROVIDER=anthropic` and fix any differences between the two providers (prompt wording, file handling).
- Check phone layout, loading states and error messages ("Something went wrong reading this file – try again").
- Confirm environment variables and spending limits on both accounts.

**Done when:** Three clean runs in a row on production with each provider.

## Step 12 – Record the demo video (1.5 hours)

**Needs:** Step 11.

**Build:** Screen recording (about 3 minutes) that shows every feature, in this order:
1. **Landing** – before/after card, press "Try the demo".
2. **Inbox** – type tabs, a supplier's history tab, the rules card, then "Add quotes" with one small file of your own, then "Process inbox".
3. **Agent run** – live step tiles and the "What the agent is doing" panel, "Pause agent" and "Resume", a card's Result and Original file tabs, then the Extracted data and Activity log tabs.
4. **Review queue** – reason tabs, a card's Original text and Price history tabs, one Edit, then Approve the rest.
5. **Price lists** – markup buttons, Customer and Internal tabs, Save version, Versions, Compare, Export PDF.
6. **Ask** – the new M6 Express quote card and "Review v4", then all three suggested questions with their sources.
7. **Reset demo** – show the inbox back to fresh.

Add the link to the Tutorial video button.

**Done when:** The video is live and linked from the Landing page.

## Time budget

| Day | Steps |
|---|---|
| Day 1 morning | Steps 0–3 |
| Day 1 afternoon and evening | Steps 4–5 |
| Day 2 morning | Steps 6–8 |
| Day 2 afternoon | Steps 9–11 |
| Day 2 evening | Step 12 |

Nothing gets cut. Every feature on the six screens ships and appears in the demo video. The plan is tight for 48 hours, so keep to the step order and don't start polish (Step 11) until Steps 5–10 are working.
