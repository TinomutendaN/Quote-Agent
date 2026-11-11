# Quote Agent demo screens – image prompts

How to use: paste the **Shared style** block first, then add the prompt for the screen you're generating.

## Shared style (paste before every screen prompt)

```
Clean, flat desktop SaaS web app screenshot, 1280px wide, straight-on view, no perspective, no device frame. Light theme. Page background #FAFBFC, white (#FFFFFF) sidebar and cards, 1px borders #E6E8EC, card corner radius 6px, very soft even shadow (0 1px 3px, 6% opacity), no dramatic lighting, no gradients, no glow. Text dark navy #1B2440, secondary text slate #4A5368 / #5B6478. Primary blue #1D4ED8 for buttons and links. Pastel status colours: salmon #FBBDAB, sky blue #B9D6FB, lavender #CDBDF2, mint #BDEBD3. Progress bars: green #5BD6A4, amber #FDBA3A, light grey #E9EBEF. Font: Inter, headings semi-bold, small uppercase labels with slight letter spacing. Icons: thin outline line icons, 1.6–1.8px stroke, rounded caps. Buttons: 4px radius, uppercase 13px semibold labels. No people, no photos, no characters — suppliers shown as small coloured circles with two initials. Left sidebar 230px: logo is a navy rounded square with three white horizontal lines next to the bold word "Quote Agent"; a small grey "MAIN MENU" label; menu items with outline icons: Inbox, Agent run, Review queue (small salmon badge "4"), Price lists, Ask; active item has a light grey rounded highlight; footer text "Northline Couriers · sample data". Top of main area: small back/forward chevrons and a breadcrumb on the left, action buttons on the right; below it a large page title; then a row of uppercase icon tabs with a navy underline on the active tab and "SORT" and "FILTERS" on the right.
```

## 1. Landing

```
Landing page, no sidebar. Thin white top bar with the Quote Agent logo and a small yellow "BETA" tag (#FDE68A, brown text). Left half: small uppercase label "AI AGENT FOR SUPPLIER QUOTES", large headline "Turn messy supplier quotes into clean price lists in minutes.", a short grey paragraph, then two buttons: solid blue "+ TRY THE DEMO" and white outlined "▶ TUTORIAL VIDEO", and a tiny note "No signup. Sample data is a fictional courier company, Northline Couriers." Right half: one white card with a salmon left panel containing a white box with a red clock icon and "1 to check", then "3 Prices found" and "Cleaned in 4 seconds". Card body: title "Pennine Freight – RE: Leeds run tmrw", tabs ORIGINAL / CLEANED (CLEANED active), a light grey quote box with a casual email, a dashed green pill "Sorted using your rules", then three small tiles with grey header pills STANDARD (Leeds local £165), OUT-OF-HOURS (Leeds after 6pm £205), and a pale red CHECK pill (Manc → London £310 for 2 pallets?). Bottom row: three equal white cards each with a coloured square on the left showing a number (1 sky blue, 2 salmon, 3 lavender): "Reads anything", "Asks before guessing", "Builds your price lists".
```

## 2. Inbox

```
Inbox screen. Breadcrumb "Inbox"; top-right buttons: white outlined "+ ADD QUOTES" and blue "▶ PROCESS INBOX". Title "Inbox". Tabs: ALL QUOTES (15) active, EMAILS (5), PDFS (5), SPREADSHEETS (5). Short grey line explaining quotes are grouped by supplier. Stacked supplier cards, each with a coloured left panel (about 130px wide) holding a white box with a clock icon and a status word, then a count and "First received" time. Card 1: sky-blue panel, status "New" in blue, "Pennine Freight – 3 quotes", tabs FILES / SUPPLIER HISTORY / CONTACT, three file tiles in a row, each with a grey time pill on top (08:12, 11:48, 14:05) and a double-arrow icon, an outline mail/document icon, file name, type, initials circle "DP" with sender name, and an uppercase note like "2 PRICES SPOTTED". Card 2: salmon panel, status "Hard to read" in red, "Riverside Logistics – 1 scan", one tile "quote_scan_0031.pdf · Scanned PDF · LOW QUALITY SCAN". Card 3: lavender panel, "Swift Haul Ltd – 3 quotes" with a spreadsheet tile and two email tiles. Final card: mint panel with a green tick and "Active", "5 rules", title "Northline Couriers – Sorting rules", a dashed green pill, and five tiles with grey pills RULE 1–RULE 5 containing short plain-English rules.
```

## 3. Agent run

```
Agent run screen. Breadcrumb "Agent run"; top-right buttons: outlined "PAUSE AGENT" and blue "OPEN REVIEW QUEUE (4)". Title "Agent run" with a yellow BETA tag. Tabs: LIVE RUN active, EXTRACTED DATA, ACTIVITY LOG. A line "Goal: turn the inbox into clean, sorted price data • Quotes handled: 13 of 15". A segmented bar: wide green "9 Ready", medium amber "4 Need you", small grey "2 Working". Left column: three stacked cards with coloured left panels (salmon "Needs you", sky blue "Done", lavender "Working"). Each card has a small "NOW" label, a thin vertical blue line, then a horizontal row of step tiles with grey pills STEP 1, STEP 2, STEP 3 and double-arrow icons; each tile has a wrench outline icon, a short step title, a time like "2.1 sec", a small grey monospace tool chip (read_document, extract_quote, compare_history) and a one-line note. Each row ends with an outlined circle badge: amber "SENT TO REVIEW", blue "READY", purple "IN PROGRESS". Right column: a white floating panel with a stronger soft shadow, labelled "CURRENT JOB" (lavender circle icon, "M6 Express – Q-2291.pdf, Sorting jobs with your rules"), a divider, then "WHAT THE AGENT IS DOING": six rows, each with a numbered pastel circle, a sentence and a monospace tool chip, and a blue link "SEE FLAGGED ITEMS" at the bottom.
```

## 4. Review queue

```
Review queue screen. Breadcrumb "Review queue"; top-right blue button "CONTINUE TO PRICING". Title "Review queue". Tabs: ALL (4) active, PRICE LOOKS WRONG, DUPLICATES, UNCLEAR. Grey line: "The agent stopped on these instead of guessing." Four stacked white cards, each with a thin 24px solid colour strip on its left edge and no text in it (salmon, lavender, sky blue, salmon). Card content: title like "Riverside Logistics – Leeds → Bristol £480", tabs GENERAL / ORIGINAL TEXT / PRICE HISTORY, a dashed amber pill with a warning icon "About 3× the usual £160 for this route", a row of three outline-icon details (supplier, file name, route), a light grey box with the original quote text, then "AGENT SUGGESTS" label with one sentence, and on the right three buttons: blue APPROVE, outlined EDIT, outlined REJECT.
```

## 5. Price lists

```
Price lists screen. Breadcrumb "Price lists"; top-right buttons: outlined "SAVE VERSION" and blue "EXPORT PDF". Title "Price lists". Tabs: CURRENT LIST active, VERSIONS (3), COMPARE. One large card with a lavender left panel: white box "v3 Draft", "8/8 Routes approved", divider, "Saved versions" with blue links "v2 · Swift Haul update" and "v1 · first list". Card body: title "Northline Couriers – Price list v3", sub-tabs CUSTOMER LIST (active) / INTERNAL LIST, a line "Total supplier cost: £1,678 (8 routes) • Total selling price: £2,145", a two-part bar: smaller green "£467 Margin (22% of sales)" and larger amber "£1,678 Supplier cost (8 quotes)". Below: "MARKUP ON STANDARD JOBS" with three buttons 15%, 25% (solid blue, selected), 35%; beside it "CATEGORY EXTRAS: Out-of-hours +10 points, Specialist +15 points". Then a clean table with a light grey header ROUTE / SERVICE / PRICE (EX VAT) and eight rows of UK routes (Leeds local, Manchester → London, Bristol hospital run, Birmingham → London…) with bold £ prices.
```

## 6. Ask

```
Ask screen. Breadcrumb "Ask"; top-right outlined button "SAVED ANSWERS". Title "Ask about your prices" with a yellow BETA tag. Tabs: CHAT active, SAVED ANSWERS, AUTOMATIC UPDATES. Top card with a sky-blue left panel: white box with clock icon "New quote" in blue, "Arrived Today 14:32". Card body: title "M6 Express – London → Manchester £270", a dashed green pill with a tick "Handled automatically – waiting for your approval", one sentence saying it is 8% cheaper than Swift Haul and draft v4 is ready, and a blue "REVIEW V4" button. Below: a large chat card. Right-aligned navy speech bubble with white text "What's our typical cost for London to Manchester?". Then three small grey monospace chips (query_approved_quotes, filter: London → Manchester, compute_typical). Answer text: "For a standard weekday job the typical cost is £283, based on 2 approved quotes. The weekend rate is £320." A "QUOTES USED" list of three rows, each with a pastel initials circle (SH lavender, M6 sky blue), supplier name, grey detail like "£295 · weekday · 3 Nov", and a blue "OPEN" link on the right. A small grey caution line, three rounded outlined suggestion buttons, and at the bottom a wide text input "Ask anything about your quotes and prices…" with a blue "ASK" button.
```
