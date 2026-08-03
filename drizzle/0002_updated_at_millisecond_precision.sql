-- Custom SQL migration file, put your code below! --

-- Pin every synced `updated_at` to MILLISECOND precision.
--
-- Why (the internal security audit F-15): Postgres `now()` returns a `timestamptz` with MICROSECOND
-- resolution. Every layer above the database — drizzle's timestamp mapper, the JSON wire
-- shape (`Date.prototype.toISOString`), and the client — represents that value as a
-- JavaScript `Date`, which has only millisecond resolution and TRUNCATES. So a row stored
-- at `11:33:21.216435` is handed to the client as `11:33:21.216Z`, and when that value
-- comes back as the delta-pull cursor the comparison
--
--     updated_at > '11:33:21.216Z'        -- .216435 > .216000  =>  TRUE
--
-- re-selects the very row the cursor was built from. The cursor can never advance past
-- its own last row: every pull re-delivers the tail, and a table with more than
-- PULL_PAGE_LIMIT changed rows paginates forever on the same page.
--
-- This was invisible to the whole P2.1/P2.3 test suite because PGlite's `now()` emits
-- only 3 fractional digits (measured: 77, 772, 773, 774, ...), so the truncation is a
-- no-op there. It is NOT a no-op on Neon. Truncating at write time makes the stored value
-- and the JavaScript `Date` bit-for-bit equal on every engine, which is what the compound
-- `(updated_at, id)` cursor already assumes.
--
-- No backfill statement: there is no deployed database yet (the project plan publish hold), so
-- there are no rows to correct — and an `UPDATE` here would re-fire this very trigger and
-- rewrite real history with `now()`. If this ever ships to a database that already holds
-- rows, correct them with the trigger disabled, in a separate reviewed migration.
CREATE OR REPLACE FUNCTION fitmacro_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := date_trunc('milliseconds', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
