# CLAUDE.md – Quote Agent build guide

Quote Agent is a demo app: an AI agent that reads messy supplier quotes, sorts them with the business's rules, stops for human approval on anything odd, and builds price lists. See AGENTS.md for the feature list and tech stack.

Solo developer, 48-hour build, deployed on Vercel. The app is built **one screen at a time, each with its real logic**, in the same order as the demo. Each step ends with something you can click and test. Do not start a step until the previous one passes its "Done when" check.

## Progress

| Step | Status |
|---|---|
| 0 – Accounts and keys | Done |
| 1 – Project setup | Done |
| 2 – Database | Done |
| 3 – Sample quote files | Done |
| 4 – Shell + Inbox | Done |
| 5 – The agent (no screen) | Done |
| 6 – Agent run screen | Next |
| 7 – Review queue | |
| 8 – Price lists | |
| 9 – Ask + the new quote | |
| 10 – Landing + Reset demo | |
| 11 – Full testing | |
| 12 – Demo video | |

Update this table at the end of each step.

## Working rules

- Build only the step you are asked to build. Stop at the end of it and report.
- Stay inside the agreed stack. Do not add a dependency without asking first. Runtime dependencies are capped at 10 (currently at 10).
- The designs in `docs/design/` are the visual source of truth (see `docs/design/README.md` for how to read them). Copy their colours, spacing, font sizes, borders, radii, shadows and wording. Where `quote-agent-screen-prompts.md` disagrees with them, the design files win.
- Every visible button, tab and link must work by the end of its step. A button whose logic belongs to a later step stays hidden until that step.
- All UI text in plain English. No jargon on screen.
- The model does the reading. Do not add PDF parsers or text-recognition libraries.
- All model calls go through `lib/ai/model.ts`. No other file imports `@ai-sdk/openai` or `@ai-sdk/anthropic` directly. Build and test with `AI_PROVIDER=openai`; the app must also work unchanged with `AI_PROVIDER=anthropic`.
- The installed AI SDK is v7 (it uses `instructions` and `isStepCount()`). Follow the installed version's API, not older examples.
- Never let the model run free-form SQL. Every database action is a fixed, parameterised query in `lib/db.ts` behind a tool.
- Price and version logic lives in one place, `lib/pricing.ts`, and is reused by the Price lists screen and the Ask tools.
- `public/samples/README.md` is the answer key for every test of the agent.
- Never run `vercel env pull`; it would overwrite `.env.local`.
- When unsure about a requirement, ask instead of guessing.

## Decisions already made

**The five rules** (stored in the `rules` table, word for word):
1. After 6pm or at weekends is Out-of-hours.
2. Medical, fragile or chilled goods are Specialist.
3. Everything else is Standard.
4. Flag prices 50% above our usual for the route.
5. Prices exclude VAT unless the quote says otherwise.

Per-pallet and unclear-unit handling belongs in the agent's system prompt, not in the rules.

**Data**
- **Past prices** (`quote_lines.is_history = true`) are only for `compare_history` and for price lists v1 and v2. Ask answers and new price lists must exclude them, so the London → Manchester typical cost stays at £283.
- **Scans** are stored as type `scan`, separate from `pdf`. The Inbox "PDFs" tab counts pdf + scan (7).
- **Categories** are stored as shown on screen: `Standard`, `Out-of-hours`, `Specialist`. A quote line's category can be empty until the rules sort it.
- **Status and reason codes** are lowercase: e.g. `needs_review`, `price_wrong`, `duplicate`, `unclear`, `unknown_sender`.
- **Routes** are one text field, `Origin → Destination`. Matching different spellings of the same route (e.g. "Leeds - Bristol") is the job of `compare_history`.
- **Extra columns** beyond the original plan: `source_files.sender_name`, `suppliers.initials`, `review_items.resolved_at`, `quote_lines.time_slot` (`weekday`/`evening`/`overnight`/`weekend`) and `quote_lines.goods` (`general`/`chilled_medical`/`fragile`/`secure`). Two lines are the same job (a possible duplicate) only when supplier, route, category, time slot and goods all match and they come from different files.
- **Rule precedence:** Specialist (rule 2) wins over Out-of-hours (rule 1), e.g. chilled goods on a Saturday are Specialist.

**Pricing**
- **Price list rule:** for each route and service, use the cheapest approved quote (excluding past prices).
- **Markup:** sell price = cost × (1 + markup). Standard uses the chosen markup (15, 25 or 35%, default 25%); Out-of-hours adds 10 points; Specialist adds 15 points. Stored as e.g. `{"standard":25,"out_of_hours":35,"specialist":40}`.
- **Versions:** v1 and v2 are seeded. The list built from the first approved run is v3 (draft until saved). The new M6 Express quote creates draft v4.

**Demo behaviour**
- **Process inbox runs once per reset.** If the sample inbox has already been processed, the button shows the saved results instead of running again.
- **New quote moment is automatic.** When the last inbox file finishes, the agent processes the held-back M6 Express email (file 16) once.
- **Reset demo** lives in the sidebar footer. All visitors share one database; reset restores the fresh sample data by re-running `db/schema.sql` and `db/seed.sql`.
- **Rules are read-only** in the demo.
- **Uploads ("Add quotes")** are processed immediately because files aren't stored. Keep upload size small and show a clear message if a file is too large or the wrong type.
- **Removed from the designs (do not build):** Sort and Filters, card Edit/More/Expand icons, supplier Contact tab, Edit rules tab, Saved answers, Automatic updates tab.

## What's already built (Steps 0–3)

- **Accounts:** OpenAI and Anthropic keys with spending limits; GitHub and Vercel connected. OpenAI model: `gpt-6.1-sol` (tool calls need OpenAI's Responses API).
- **Project:** Next.js 16 with TypeScript, App Router, Tailwind, ESLint, `@/*` alias, no `src/` folder. 10 runtime dependencies, SheetJS installed from its CDN.
- **Environment variables** (`.env.local`, also needed on Vercel): `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-sonnet-5-5`, `DATABASE_URL`.
- **`lib/ai/model.ts`:** returns the OpenAI or Claude model based on `AI_PROVIDER`, with clear errors for missing settings. `app/api/test-ai` is a temporary test route.
- **Database (Neon):** tables `suppliers` (5), `rules` (5), `source_files` (18: 17 inbox files plus file 16 held back; file 12 has no supplier), `quote_lines` (21 past prices only), `review_items` (0), `agent_events` (0), `price_lists` (2: v1 "First list", v2 "Swift Haul update"). `npm run db:setup` drops and recreates everything in one transaction and can be re-run safely. `lib/db.ts` holds the read functions.
- **Sample files:** 18 files plus the answer key in `public/samples/`. Key review cases:
  - **Price looks wrong:** file 10, Leeds → Bristol £480 against a usual £160. Suggestion: check with the supplier.
  - **Duplicate:** files 03 and 04, Saturday London → Manchester at £340 then £320. Suggestion: keep £320 from the later email.
  - **Unclear:** file 01, "2 pallets £310". Suggestion: record £155 per pallet.
  - **Unknown sender:** file 12. Suggestion: choose the supplier or reject the file.

## Step 4 – Shell + Inbox (3 hours)

**Needs:** Steps 1–3. `quote-agent-designs.zip` is in the project root.

**Build:**
- Unzip `quote-agent-designs.zip` into `docs/design/` and read `docs/design/README.md`.
- Design tokens (colours, radius, shadow) set up once in the global CSS/Tailwind setup; Inter through `next/font`.
- Shared components: sidebar (Quote Agent logo, MAIN MENU, five menu items with icons, Review queue badge from the database, footer with "Northline Couriers · sample data" and a "Reset demo" link – hidden until Step 10), page header (back/forward arrows using browser history, breadcrumb, action buttons, title, uppercase tabs), card with coloured left status panel, card with thin colour strip, dashed pill, grey-pill tile, progress bar, tabs.
- A shared layout for the five app pages so the sidebar isn't repeated. The other four app pages show a simple "Coming soon" placeholder inside the layout for now.
- **Inbox with real data from the database:**
  - Supplier cards built from `source_files` (held-back file 16 hidden), grouped by supplier, with sender name and received time on each tile. File 12 shows as "Unknown sender".
  - Tile notes show "Not processed yet" before the agent has run.
  - Type tabs (All / Emails / PDFs / Spreadsheets) filter the cards, with counts from the database (5 / 7 / 5).
  - Card tabs: Files (the tiles) and Supplier history (that supplier's past prices).
  - Rules card reads from the `rules` table.
  - "Process inbox" and "Add quotes" stay hidden until Step 6.
- Phone-width layout: the sidebar stacks above the content, wide content scrolls sideways inside its own box, nothing overflows the page.

**Done when:** The Inbox matches the design and shows exactly the 17 files, suppliers, senders and times in `public/samples/README.md`; the type tabs show 5 / 7 / 5; Supplier history shows the seeded past prices; it works at phone width.

## Step 5 – The agent, without a screen (5 hours – most important step)

**Needs:** Step 2.

**Build `app/api/agent/route.ts`:**
- Input: one `source_file_id`. Processes one quote per request.
- Load the file and convert it by type:
  - PDF or scan → document or image block (the model reads it directly). Test the scanned files on OpenAI first; if a provider can't take a file type directly, handle the conversion inside the file converter for that provider only.
  - Spreadsheet → SheetJS → CSV text (every tab, labelled by tab name).
  - Email → plain text.
- System prompt: the goal ("turn this quote into clean, sorted price data"), the rules loaded from the `rules` table, per-pallet and unclear-unit handling, and the instruction to flag anything uncertain instead of guessing.
- Tools (Zod inputs, each a fixed SQL query in `lib/db.ts`):
  - `save_quote_line` – store one extracted price
  - `apply_rules` – record the category and which rule decided it
  - `compare_history` – usual price for a route from past prices
  - `check_duplicates` – same supplier, route and service already in this batch at a different price (same price repeated is not a duplicate)
  - `flag_for_review` – create a review item with reason, original text excerpt, usual price and suggestion
- Log every tool call to `agent_events` automatically with a plain-English line and its duration. Update the file's status (`working`, `done`, `needs_review`).
- Get the model from `lib/ai/model.ts`. Use the AI SDK's streaming call with tools and a step limit so the agent loops until done, and stream events back.
- Set `maxDuration` on the route after checking Vercel's current function limits.
- A test script (e.g. `npm run agent:test -- 10`) that runs the agent on one or all files and prints the saved lines, categories, review items and events, so results can be checked against the answer key without any screen.

**Done when:** Running all 17 inbox files gives the results in `public/samples/README.md`: exactly the 4 review items listed above, correct categories for the rule examples, the handwriting photo (17) and the fax (18) read correctly, and the subtotal in file 07 is not saved as a price. Run the full set three times (resetting between runs); results must match each time.

## Step 6 – Agent run screen (4 hours)

**Needs:** Steps 4 and 5.

**Inbox additions:**
- "Process inbox": if the sample inbox is already processed, go to Agent run and show saved results; otherwise send the files to `/api/agent` one after another from the browser.
- After processing, tile notes show the real count (e.g. "2 prices found").
- "Add quotes": `app/api/upload/route.ts` accepts one small file (email text, PDF, image, spreadsheet), creates a `source_files` row marked as an upload, and runs the agent on it immediately. Clear errors for files that are too large or the wrong type.

**Agent run screen:**
- Each quote card fills its step tiles as tool calls stream in, with step times. Map tool names to plain-English titles (e.g. `compare_history` → "Compare with past prices").
- Card tabs: Steps (tiles), Result (prices saved from that file), Original file (opens the sample from `public/samples`; for uploads say the original isn't kept).
- "What the agent is doing" panel shows the current job and the latest events, newest on top.
- Page tabs: Live run (cards), Extracted data (table of all saved prices), Activity log (every event).
- Progress bars (Ready / Need you / Working) count from the database.
- End circle per card: "Sent to review", "Ready" or "In progress".
- "Pause agent" stops the browser queue after the current file finishes; the button changes to "Resume".
- When the last inbox file finishes, automatically run the agent once on the held-back file 16.

**Done when:** Pressing Process inbox shows the agent working through all 17 files live, ending with 4 items in review; file 16 is then processed automatically; pause and resume work; pressing Process inbox again shows saved results without a new run; an uploaded file is processed and appears in the Inbox.

## Step 7 – Review queue (2 hours)

**Needs:** Step 6.

**Build:**
- List open review items with a colour strip by reason.
- Reason tabs (All / Price looks wrong / Duplicates / Unclear) filter the list.
- Card tabs: General (reason, details, suggestion), Original text (stored excerpt), Price history (usual price and past quotes for that route).
- Approve / Edit / Reject update `review_items` (with `resolved_at`) and the linked `quote_lines` status. Edit opens a small inline form for price, route and category. For the unknown-sender file, Edit lets the user pick the supplier.
- Quote lines that were never flagged are approved automatically when the run finishes.
- "Continue to pricing" goes to Price lists.
- Sidebar badge shows the live open count.

**Done when:** Approving or editing all four items leaves the queue empty, the lines show as approved, and the sidebar badge reaches zero.

## Step 8 – Price lists (3 hours)

**Needs:** Step 7.

**Build in `lib/pricing.ts` (plain TypeScript, no AI):**
- Build rows: cheapest approved quote per route and service, excluding past prices.
- Markup maths as set out in "Decisions already made".
- Compare two versions: added, removed and changed prices.

**Screen:**
- Current list is draft v3 until saved. Markup buttons (15 / 25 / 35%), Customer and Internal tabs, totals and the margin vs cost bar.
- Page tabs: Current list, Versions (all saved versions, each can be opened), Compare (pick two versions, see what changed).
- "Save version" stores a snapshot in `price_lists`; saved versions also listed in the left panel.
- "Export PDF" uses a print stylesheet (hide sidebar and buttons) and the browser's Save as PDF.

**Done when:** Changing markup updates every number and matches hand calculation; a saved version can be reopened; Compare shows the right differences between v1 and v2 (3 Swift Haul routes) and between v2 and v3; the printed PDF looks clean.

## Step 9 – Ask + the new quote (3 hours)

**Needs:** Step 8.

**Build:**
- `app/api/ask/route.ts`: the model from `lib/ai/model.ts` with three read-only tools that call `lib/db.ts` and `lib/pricing.ts` (all excluding past prices):
  - `query_approved_quotes` – filter by route, supplier, service
  - `get_price_list` – current or a given version, including margins
  - `compare_versions` – what changed between two versions
- Answers must list the quotes used. Each "Open" link opens the original file.
- Ask screen: chat, tool chips shown above each answer, "Quotes used" list, three suggested questions that send when clicked ("Which supplier is cheapest for Leeds?", "What changed since v2?", "Our margin on Specialist jobs?").
- New-quote card: shows the result of the automatic run on file 16: price (£270), comparison with Swift Haul (£295, about 8% cheaper), and a "Review v4" button. Draft v4 is the current list recalculated with the M6 Express quote included, with a note naming the new quote; saving v4 approves that quote.

**Done when:** "What's our typical cost for London to Manchester?" answers £283 (from £295 and £270) with its sources; all three suggested questions return correct answers with sources; "Review v4" opens draft v4 and saving it works.

## Step 10 – Landing + Reset demo (1.5 hours)

**Needs:** Step 4.

**Build:**
- Landing page as designed: "Try the demo" opens the Inbox; "Tutorial video" links to the recording (add the link in Step 12).
- `app/api/reset/route.ts`: re-runs `db/schema.sql` and `db/seed.sql` (the same logic as `npm run db:setup`). Show the "Reset demo" link in the sidebar footer, with a short confirmation.
- Remove the temporary `app/api/test-ai` route.

**Done when:** Reset returns the app to a fresh 17-quote inbox with v1 and v2 price lists, and Process inbox runs again afterwards.

## Step 11 – Full testing (3 hours)

**Needs:** Steps 4–10.

**Build:**
- Full run-through on the live Vercel URL, three times, resetting in between.
- Click every button, tab and link on all six screens; nothing may be dead.
- Check results match `public/samples/README.md` every run.
- Repeat the full run with `AI_PROVIDER=anthropic` and fix any differences between the two providers (prompt wording, file handling).
- Check phone layout, loading states and error messages ("Something went wrong reading this file – try again").
- Confirm environment variables on Vercel and spending limits on both accounts.

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

| When | Steps |
|---|---|
| Day 1 (done) | Steps 0–3 |
| Day 1 evening | Steps 4–5 |
| Day 2 morning | Steps 6–8 |
| Day 2 afternoon | Steps 9–11 |
| Day 2 evening | Step 12 |

Nothing gets cut. Every feature on the six screens ships and appears in the demo video. Keep to the step order and don't move on until a step passes its "Done when" check.