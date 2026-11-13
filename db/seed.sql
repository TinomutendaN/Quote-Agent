-- Quote Agent seed data. Run after schema.sql (npm run db:setup).
-- Source of truth: public/samples/README.md. All companies and people are fictional.

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
INSERT INTO suppliers (name, initials, colour) VALUES
  ('Pennine Freight',     'PF', '#BDEBD3'),  -- mint
  ('Riverside Logistics', 'RL', '#FBBDAB'),  -- salmon
  ('Swift Haul Ltd',      'SH', '#CDBDF2'),  -- lavender
  ('M6 Express',          'M6', '#B9D6FB'),  -- sky blue
  ('Capital Same-Day',    'CS', '#FDE68A');  -- amber

-- ---------------------------------------------------------------------------
-- Sorting rules (read-only in the demo)
-- ---------------------------------------------------------------------------
INSERT INTO rules (number, text) VALUES
  (1, 'After 6pm or at weekends is Out-of-hours.'),
  (2, 'Medical, fragile or chilled goods are Specialist.'),
  (3, 'Everything else is Standard.'),
  (4, 'Flag prices 50% above our usual for the route.'),
  (5, 'Prices exclude VAT unless the quote says otherwise.');

-- ---------------------------------------------------------------------------
-- Source files: 17 inbox files + the held-back file 16. All received
-- Wednesday 11 November 2026 (UK time). Everything starts as 'waiting'.
-- ---------------------------------------------------------------------------
INSERT INTO source_files (supplier_id, sender_name, file_name, file_path, type, received_at, is_held_back)
SELECT s.id, v.sender_name, v.file_name, '/samples/' || v.file_name, v.type,
       (v.received || ' Europe/London')::timestamptz, v.is_held_back
FROM (VALUES
  ('Pennine Freight',     'Dan Price',           '01_pennine_leeds_run.txt',                     'email',       '2026-11-11 08:12', false),
  ('Pennine Freight',     'Dan Price',           '02_pennine_pallet_rates_manchester.txt',       'email',       '2026-11-11 14:05', false),
  ('Swift Haul Ltd',      'Mo Khan',             '03_swifthaul_fwd_weekend_availability.txt',    'email',       '2026-11-11 11:30', false),
  ('Swift Haul Ltd',      'Mo Khan',             '04_swifthaul_weekend_rate_update.txt',         'email',       '2026-11-11 12:10', false),
  ('Capital Same-Day',    'Priya Shah',          '05_capital_sameday_medical_bristol.txt',       'email',       '2026-11-11 10:01', false),
  ('Pennine Freight',     'R. Moorhouse',        '06_Pennine_Freight_Q4_tariff.pdf',             'pdf',         '2026-11-11 11:48', false),
  ('M6 Express',          'Gary Holt',           '07_M6_Express_Quotation_Q-2291.pdf',           'pdf',         '2026-11-11 09:22', false),
  ('Capital Same-Day',    'Capital Same-Day',    '08_Capital_SameDay_rate_card.pdf',             'pdf',         '2026-11-11 09:40', false),
  ('M6 Express',          'M6 Express',          '09_M6_Express_out_of_hours_supplement.pdf',    'pdf',         '2026-11-11 10:20', false),
  ('Riverside Logistics', 'S. Okafor',           '10_quote_scan_0031.pdf',                       'scan',        '2026-11-11 09:05', false),
  ('Swift Haul Ltd',      'Swift Haul Ltd',      '11_Swift_Haul_rates_Nov.xlsx',                 'spreadsheet', '2026-11-11 08:40', false),
  (NULL,                  NULL,                  '12_rates (2).csv',                             'spreadsheet', '2026-11-11 10:15', false),
  ('Riverside Logistics', 'Riverside Logistics', '13_Riverside_Logistics_rates.xlsx',            'spreadsheet', '2026-11-11 09:15', false),
  ('M6 Express',          'M6 Express',          '14_M6_Express_lanes.csv',                      'spreadsheet', '2026-11-11 13:10', false),
  ('Capital Same-Day',    'Capital Same-Day',    '15_Capital_SameDay_zones.xlsx',                'spreadsheet', '2026-11-11 13:45', false),
  ('M6 Express',          'Gary Holt',           '16_HELD_BACK_m6express_london_manchester.txt', 'email',       '2026-11-11 14:32', true),
  ('Pennine Freight',     'D. Price',            '17_pennine_quote_pad_photo.pdf',               'scan',        '2026-11-11 15:20', false),
  ('Swift Haul Ltd',      'Mo Khan',             '18_swifthaul_fax_extra_lanes.pdf',             'scan',        '2026-11-11 15:02', false)
) AS v(supplier_name, sender_name, file_name, type, received, is_held_back)
LEFT JOIN suppliers s ON s.name = v.supplier_name
ORDER BY v.file_name;

-- ---------------------------------------------------------------------------
-- Past approved prices (is_history = true), October 2026.
-- Only for compare_history and for building v1/v2 below.
-- Every price is within 15% of the matching prices in the sample files,
-- except Leeds → Bristol, where the usual £160 makes the £480 scan stand out.
-- ---------------------------------------------------------------------------
INSERT INTO quote_lines (supplier_id, route, category, rule_number, price, unit_note, vat_note, time_slot, goods, quote_date, status, is_history)
SELECT s.id, v.route, v.category, v.rule_number, v.price, 'per job', 'ex VAT', v.time_slot, v.goods, v.quote_date::date, 'approved', true
FROM (VALUES
  -- Leeds → Bristol: usual about £160
  ('Pennine Freight',     'Leeds → Bristol',              'Standard',     3, 158.00, '2026-10-02', 'weekday', 'general'),
  ('Riverside Logistics', 'Leeds → Bristol',              'Standard',     3, 160.00, '2026-10-07', 'weekday', 'general'),
  ('Pennine Freight',     'Leeds → Bristol',              'Standard',     3, 162.00, '2026-10-12', 'weekday', 'general'),
  -- London → Manchester weekday: usual about £290
  ('Swift Haul Ltd',      'London → Manchester',          'Standard',     3, 295.00, '2026-10-05', 'weekday', 'general'),
  ('Swift Haul Ltd',      'London → Manchester',          'Standard',     3, 285.00, '2026-10-22', 'weekday', 'general'),
  -- London → Manchester Saturday: usual about £330
  ('Swift Haul Ltd',      'London → Manchester',          'Out-of-hours', 1, 335.00, '2026-10-05', 'weekend', 'general'),
  ('Swift Haul Ltd',      'London → Manchester',          'Out-of-hours', 1, 325.00, '2026-10-22', 'weekend', 'general'),
  -- Other routes
  ('Swift Haul Ltd',      'London → Birmingham',          'Standard',     3, 215.00, '2026-10-05', 'weekday', 'general'),
  ('Swift Haul Ltd',      'London → Birmingham',          'Standard',     3, 205.00, '2026-10-22', 'weekday', 'general'),
  ('Swift Haul Ltd',      'London → Leeds',               'Standard',     3, 280.00, '2026-10-05', 'weekday', 'general'),
  ('Pennine Freight',     'Leeds → Manchester',           'Standard',     3, 145.00, '2026-10-02', 'weekday', 'general'),
  ('Pennine Freight',     'Leeds → Sheffield',            'Standard',     3, 110.00, '2026-10-06', 'weekday', 'general'),
  ('Riverside Logistics', 'Leeds → Sheffield',            'Standard',     3, 106.00, '2026-10-09', 'weekday', 'general'),
  ('Riverside Logistics', 'Castleford → Manchester',      'Standard',     3, 135.00, '2026-10-07', 'weekday', 'general'),
  ('Riverside Logistics', 'Leeds → Cardiff',              'Standard',     3, 170.00, '2026-10-07', 'weekday', 'general'),
  ('M6 Express',          'Birmingham → London',          'Standard',     3, 205.00, '2026-10-08', 'weekday', 'general'),
  ('M6 Express',          'Birmingham → Manchester',      'Standard',     3, 165.00, '2026-10-08', 'weekday', 'general'),
  ('M6 Express',          'Birmingham → London',          'Out-of-hours', 1, 265.00, '2026-10-08', 'evening', 'general'),
  ('Capital Same-Day',    'Bristol Royal Infirmary → Filton', 'Specialist', 2, 232.00, '2026-10-01', 'weekday', 'chilled_medical'),
  ('Capital Same-Day',    'Bristol → Swindon',            'Specialist',   2, 300.00, '2026-10-01', 'weekday', 'fragile'),
  ('Capital Same-Day',    'Bristol → Bath',               'Standard',     3,  75.00, '2026-10-01', 'weekday', 'general')
) AS v(supplier_name, route, category, rule_number, price, quote_date, time_slot, goods)
JOIN suppliers s ON s.name = v.supplier_name;

-- ---------------------------------------------------------------------------
-- Saved price lists v1 and v2, built from the history lines above with the
-- same rules and row format as new versions (lib/pricing.ts): the cheapest
-- approved price per route + service + time slot + goods + unit, markup 25%
-- Standard, 35% Out-of-hours (+10 points), 40% Specialist (+15 points).
-- Each row: {route, category, time_slot, goods, unit, supplier, cost,
-- markup_pct, sell, margin}, money in pounds to the penny.
-- v1 uses prices up to 14 Oct; v2 adds Swift Haul's cheaper 22 Oct prices.
-- ---------------------------------------------------------------------------
INSERT INTO price_lists (version, label, status, markup, rows, created_at)
SELECT p.version, p.label, 'saved', m.markup,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'route',      c.route,
                  'category',   c.category,
                  'time_slot',  c.time_slot,
                  'goods',      c.goods,
                  'unit',       c.unit,
                  'supplier',   c.supplier,
                  'cost',       c.cost,
                  'markup_pct', c.pct,
                  'sell',       round(c.cost * (1 + c.pct / 100.0), 2),
                  'margin',     round(c.cost * (1 + c.pct / 100.0), 2) - c.cost
                ) ORDER BY c.route, c.category, c.time_slot, c.goods)
         FROM (
           SELECT DISTINCT ON (q.route, q.category, q.time_slot, q.goods, lower(coalesce(q.unit_note, 'per job')))
                  q.route, q.category, q.time_slot, q.goods,
                  lower(coalesce(q.unit_note, 'per job')) AS unit,
                  s.name AS supplier, q.price AS cost,
                  CASE q.category
                    WHEN 'Standard'     THEN (m.markup->>'standard')::numeric
                    WHEN 'Out-of-hours' THEN (m.markup->>'out_of_hours')::numeric
                    ELSE                     (m.markup->>'specialist')::numeric
                  END AS pct
           FROM quote_lines q
           JOIN suppliers s ON s.id = q.supplier_id
           WHERE q.is_history AND q.status = 'approved' AND q.quote_date <= p.cutoff
           ORDER BY q.route, q.category, q.time_slot, q.goods,
                    lower(coalesce(q.unit_note, 'per job')), q.price, q.quote_date DESC
         ) c
       ), '[]'::jsonb),
       p.created_at
FROM (VALUES
  (1, 'First list',        DATE '2026-10-14', TIMESTAMPTZ '2026-10-15 09:00 Europe/London'),
  (2, 'Swift Haul update', DATE '2026-10-31', TIMESTAMPTZ '2026-10-23 09:00 Europe/London')
) AS p(version, label, cutoff, created_at)
CROSS JOIN (SELECT '{"standard":25,"out_of_hours":35,"specialist":40}'::jsonb AS markup) m;

-- ---------------------------------------------------------------------------
-- Shared demo run state: idle until someone presses Process inbox.
-- ---------------------------------------------------------------------------
INSERT INTO demo_run (id, status) VALUES (1, 'idle');
