-- Quote Agent database schema.
-- Safe to re-run: drops every demo table (children first) and recreates it.
-- Used by `npm run db:setup`, `npm run db:processed` and Reset demo.
-- daily_usage and demo_meta (at the bottom) are never dropped: they hold the
-- daily caps and the reset cooldown, which must survive every reset.

DROP TABLE IF EXISTS demo_run CASCADE;
DROP TABLE IF EXISTS agent_events CASCADE;
DROP TABLE IF EXISTS review_items CASCADE;
DROP TABLE IF EXISTS quote_lines CASCADE;
DROP TABLE IF EXISTS price_lists CASCADE;
DROP TABLE IF EXISTS source_files CASCADE;
DROP TABLE IF EXISTS rules CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;

-- Suppliers, with a colour and initials for the initials circle.
CREATE TABLE suppliers (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  initials    text NOT NULL,
  colour      text NOT NULL,              -- hex, e.g. #BDEBD3
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The business's sorting rules (read-only in the demo).
CREATE TABLE rules (
  id          serial PRIMARY KEY,
  number      integer NOT NULL UNIQUE,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per quote file: the sample inbox, the held-back file, and uploads.
CREATE TABLE source_files (
  id            serial PRIMARY KEY,
  supplier_id   integer REFERENCES suppliers(id) ON DELETE SET NULL,  -- NULL = unknown sender
  sender_name   text,                                                -- person or company shown on the tile
  file_name     text NOT NULL,
  file_path     text NOT NULL DEFAULT '',                            -- path under public/, empty for uploads
  type          text NOT NULL CHECK (type IN ('email', 'pdf', 'scan', 'spreadsheet')),
  received_at   timestamptz NOT NULL,
  is_held_back  boolean NOT NULL DEFAULT false,                      -- the "new quote" moment (file 16)
  is_upload     boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'working', 'done', 'needs_review')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX source_files_status_idx   ON source_files (status);
CREATE INDEX source_files_supplier_idx ON source_files (supplier_id);

-- Every extracted price, plus seeded past prices.
--
-- is_history = true marks seeded past prices (October 2026). They exist ONLY for
-- compare_history (the "usual price" for a route) and for building the seeded
-- price lists v1 and v2. Ask answers and new price lists must exclude them
-- (WHERE is_history = false), so for example the typical London → Manchester
-- weekday cost stays at £283 as public/samples/README.md expects.
CREATE TABLE quote_lines (
  id              serial PRIMARY KEY,
  source_file_id  integer REFERENCES source_files(id) ON DELETE CASCADE,  -- NULL for history lines
  supplier_id     integer REFERENCES suppliers(id) ON DELETE SET NULL,    -- NULL while sender unknown
  route           text NOT NULL,                                          -- "Origin → Destination"
  category        text CHECK (category IN ('Standard', 'Out-of-hours', 'Specialist')),
  rule_number     integer REFERENCES rules(number),                       -- rule that decided the category
  price           numeric(10, 2) NOT NULL CHECK (price >= 0),
  unit_note       text,                                                   -- e.g. "per pallet", "per job"
  vat_note        text,                                                   -- e.g. "ex VAT"
  -- When the job runs and what is carried. Two quotes are only the "same job"
  -- (a duplicate) when route, category, time_slot and goods all match.
  time_slot       text CHECK (time_slot IN ('weekday', 'evening', 'overnight', 'weekend')),
  goods           text CHECK (goods IN ('general', 'chilled_medical', 'fragile', 'secure')),
  quote_date      date,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  is_history      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quote_lines_status_idx         ON quote_lines (status);
CREATE INDEX quote_lines_supplier_idx       ON quote_lines (supplier_id);
CREATE INDEX quote_lines_route_category_idx ON quote_lines (route, category);
CREATE INDEX quote_lines_category_idx       ON quote_lines (category);
CREATE INDEX quote_lines_source_file_idx    ON quote_lines (source_file_id);

-- Things the agent stopped on instead of guessing.
CREATE TABLE review_items (
  id                serial PRIMARY KEY,
  quote_line_id     integer REFERENCES quote_lines(id) ON DELETE CASCADE,
  source_file_id    integer REFERENCES source_files(id) ON DELETE CASCADE,
  reason_type       text NOT NULL
                    CHECK (reason_type IN ('price_wrong', 'duplicate', 'unclear', 'unknown_sender')),
  reason_text       text NOT NULL,
  original_excerpt  text,
  usual_price       numeric(10, 2),
  suggestion        text,
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'approved', 'edited', 'rejected')),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (quote_line_id IS NOT NULL OR source_file_id IS NOT NULL)
);

CREATE INDEX review_items_status_idx ON review_items (status);
CREATE INDEX review_items_reason_idx ON review_items (reason_type);

-- One row per agent tool call, for the live panel and the Activity log.
CREATE TABLE agent_events (
  id              serial PRIMARY KEY,
  source_file_id  integer REFERENCES source_files(id) ON DELETE CASCADE,
  step_number     integer NOT NULL,
  tool_name       text NOT NULL,
  text            text NOT NULL,          -- plain-English description
  duration_ms     integer,
  created_at      timestamptz NOT NULL DEFAULT now()   -- event time
);

CREATE INDEX agent_events_file_time_idx ON agent_events (source_file_id, created_at);

-- Saved price lists. rows is a snapshot so old versions never change. The
-- current list is a draft worked out live from approved quotes (not stored).
CREATE TABLE price_lists (
  id          serial PRIMARY KEY,
  version     integer NOT NULL UNIQUE,
  label       text NOT NULL,
  status      text NOT NULL CHECK (status IN ('draft', 'saved')),
  markup      jsonb NOT NULL,             -- {"standard":25,"out_of_hours":35,"specialist":40}
  -- [{route, category, time_slot, goods, unit, supplier, cost, markup_pct, sell, margin}]
  -- (same shape for every version, see lib/pricing.ts PriceRow; money to the penny)
  rows        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The one shared "Process inbox" run (all visitors share one database).
-- Exactly one row. idle → running (one visitor claims it atomically) →
-- finished when every inbox file is done or needs review. A running run with
-- no activity for 10 minutes counts as stalled and the next start takes it over.
CREATE TABLE demo_run (
  id                integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status            text NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle', 'running', 'finished')),
  run_id            uuid,                 -- secret token held by the browser that owns the run
  started_at        timestamptz,
  last_activity_at  timestamptz,
  finished_at       timestamptz,
  saved_run         boolean NOT NULL DEFAULT false  -- true when Reset loaded the saved earlier run (daily run limit)
);

-- ---------------------------------------------------------------------------
-- Kept across resets: created only if missing, never dropped.
-- ---------------------------------------------------------------------------

-- Usage per UK day ((now() AT TIME ZONE 'Europe/London')::date), so a shared
-- public demo can't run up model costs. Counted atomically (only while under
-- the limit set by DAILY_MAX_RUNS / DAILY_MAX_UPLOADS / DAILY_MAX_QUESTIONS).
CREATE TABLE IF NOT EXISTS daily_usage (
  day        date PRIMARY KEY,
  runs       integer NOT NULL DEFAULT 0,   -- full inbox runs started (not takeovers, not file 16)
  uploads    integer NOT NULL DEFAULT 0,   -- "Add quotes" files accepted
  questions  integer NOT NULL DEFAULT 0    -- Ask questions sent to the model
);

-- One row: when Reset demo last ran (at most one reset per minute).
CREATE TABLE IF NOT EXISTS demo_meta (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_reset_at  timestamptz
);
