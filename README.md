# Quote Agent – sample supplier quotes

16 fictional supplier quotes sent to **Northline Couriers** (a fictional courier company). All companies, people, emails and phone numbers are made up (`.example` email domains, Ofcom drama phone numbers). Copy the files into `public/samples/` and use this sheet to write `db/seed.sql`.

All files are dated Wednesday 11 November 2026. All prices are in pounds and exclude VAT unless the file says otherwise.

## Files

| # | File | Supplier | Type | Received | What's inside |
|---|---|---|---|---|---|
| 01 | `01_pennine_leeds_run.txt` | Pennine Freight | Email | 08:12 | Casual reply: Leeds local run £165, evening slot £40 extra (£205), and "Manc–London 2 pallets £310 ex vat". Includes the quoted original request. |
| 02 | `02_pennine_pallet_rates_manchester.txt` | Pennine Freight | Email | 14:05 | Per-pallet rates from Manchester to 5 cities, with a minimum charge, a 10% multi-pallet discount and a timed-delivery extra. |
| 03 | `03_swifthaul_fwd_weekend_availability.txt` | Swift Haul Ltd | Email | 11:30 | Forwarded twice. The price (£340, Saturday London to Manchester) is buried in the middle of the thread. |
| 04 | `04_swifthaul_weekend_rate_update.txt` | Swift Haul Ltd | Email | 12:10 | Short new email: Saturday London to Manchester £320. Does not mention the earlier £340. |
| 05 | `05_capital_sameday_medical_bristol.txt` | Capital Same-Day | Email | 10:01 | Hospital samples run in Bristol, £240, chilled box. The validity date is only in the signature. |
| 06 | `06_Pennine_Freight_Q4_tariff.pdf` | Pennine Freight | PDF, 3 pages | 11:48 | Formal tariff: 22 standard routes split across two pages, 5 evening/weekend routes, a "routes not listed: +30%" rule, and terms. |
| 07 | `07_M6_Express_Quotation_Q-2291.pdf` | M6 Express | PDF, 2 pages | 09:22 | Quotation with 7 weekday lines and 2 Saturday lines, plus a reference subtotal that is not a price. |
| 08 | `08_Capital_SameDay_rate_card.pdf` | Capital Same-Day | PDF, 1 page | 09:40 | Rate card: 4 specialist runs (chilled, fragile, secure) and 3 general same-day runs. |
| 09 | `09_M6_Express_out_of_hours_supplement.pdf` | M6 Express | PDF, 1 page | 10:20 | Evening and overnight fixed prices for 5 routes. |
| 10 | `10_quote_scan_0031.pdf` | Riverside Logistics | Scanned PDF | 09:05 | Photo-quality scan: tilted, grainy, with a "Received" stamp and handwritten notes. 5 routes; Leeds to Bristol is printed as £480.00. |
| 11 | `11_Swift_Haul_rates_Nov.xlsx` | Swift Haul Ltd | Spreadsheet | 08:40 | 12 lanes. Price column is called "Rate (ex VAT)", with an "inc VAT" formula column next to it. Title rows above the table. |
| 12 | `12_rates (2).csv` | Unknown | Spreadsheet | 10:15 | Bare `from,to,cost` columns, 12 routes, no supplier name anywhere. |
| 13 | `13_Riverside_Logistics_rates.xlsx` | Riverside Logistics | Spreadsheet | 09:15 | Two tabs: "Standard" and "Out of hours". Column called "Price £", plus minimum charges. |
| 14 | `14_M6_Express_lanes.csv` | M6 Express | Spreadsheet | 13:10 | Postcode areas instead of city names (e.g. CV to M = Coventry to Manchester), "£/JOB" column, service codes STD and OOH. |
| 15 | `15_Capital_SameDay_zones.xlsx` | Capital Same-Day | Spreadsheet | 13:45 | Zone-based prices (Bristol zones 1–6) with merged header cells and three price columns: standard, chilled/medical, fragile. |
| 16 | `16_HELD_BACK_m6express_london_manchester.txt` | M6 Express | Email | 14:32 | **Held back.** Weekday London to Manchester £270. Processed automatically after the inbox finishes (the "new quote" moment). |

Counts for the Inbox tabs: 5 emails (01–05), 5 PDFs (06–10, including the scan), 5 spreadsheets (11–15), plus 1 held back (16).

## The four review cases (built in on purpose)

| Case | File | What the agent should do |
|---|---|---|
| Price looks wrong | 10 (scan) | Leeds to Bristol at £480 is about 3× the usual £160. Flag it with the suggestion to check with the supplier. Seed past prices so the usual Leeds to Bristol price is about £160. |
| Duplicate | 03 and 04 | Same supplier, same job (Saturday London to Manchester), two different prices: £340, then £320. Flag it and suggest keeping £320 from the later email. Only flag duplicates when the prices differ. |
| Unclear | 01 | "2 pallets £310" while other prices are per pallet. Flag it and suggest recording £155 per pallet. |
| Unknown sender | 12 | No supplier name in the file or anywhere else. Flag it and ask the user to choose the supplier or reject the file. |

Everything else should process cleanly, so a full run ends with exactly 4 items in the Review queue.

## Things that test the agent without needing a review

- **Rule 1 (out-of-hours):** the evening slot in 01, Saturday prices in 03, 04 and 07, the evening tables in 06, 09 and 13, and `OOH` rows in 14.
- **Rule 2 (specialist):** hospital samples in 05, chilled, fragile and secure runs in 08, and the chilled/medical and fragile columns in 15.
- **Rule 5 (VAT):** 11 has both ex-VAT and inc-VAT columns; the agent must use ex VAT.
- **Reading skills:** a price buried in a forwarded thread (03), a table split across pages (06), a scan (10), odd column names (11, 13, 14), postcode areas instead of cities (14), merged header cells and zones instead of routes (15), and a subtotal that must not be saved as a price (07).

## Prices the demo story relies on

- London to Manchester, weekday: Swift Haul £295 (file 11), then M6 Express £270 (file 16, held back). M6 is about 8% cheaper, which creates draft price list v4.
- Typical weekday London to Manchester cost after file 16 is approved: (£295 + £270) ÷ 2 = £282.50, shown as £283.
- Saturday London to Manchester after review: £320.
