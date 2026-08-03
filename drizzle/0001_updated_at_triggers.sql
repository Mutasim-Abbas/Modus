-- Custom SQL migration file, put your code below! --

-- Server-assigned `updated_at`, enforced at the database layer.
--
-- the project plan P2.1 is explicit: "timestamptz everywhere, server-assigned. Never trust
-- a client clock." Application code (P2.2/P2.3) will never *send* a client-supplied
-- updated_at, but a trigger is cheap insurance against a future bug that does: no
-- matter what value NEW.updated_at holds on the way in, it is stamped with now() here,
-- for every INSERT and every UPDATE, on every table that participates in delta sync.
-- This is what makes last-write-wins actually trustworthy — the "last write" timestamp
-- is never something a client controls.
--
-- Deliberately not applied to `users`, `sessions` or `auth_attempts`: those are not
-- part of the sync surface (see docs/DB.md) and their updated_at/created_at semantics
-- are managed directly by application code in P2.2.
CREATE FUNCTION fitmacro_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_set_updated_at BEFORE INSERT OR UPDATE ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION fitmacro_set_updated_at();
--> statement-breakpoint

CREATE TRIGGER trg_set_updated_at BEFORE INSERT OR UPDATE ON "entries"
  FOR EACH ROW EXECUTE FUNCTION fitmacro_set_updated_at();
--> statement-breakpoint

CREATE TRIGGER trg_set_updated_at BEFORE INSERT OR UPDATE ON "weights"
  FOR EACH ROW EXECUTE FUNCTION fitmacro_set_updated_at();
--> statement-breakpoint

CREATE TRIGGER trg_set_updated_at BEFORE INSERT OR UPDATE ON "custom_foods"
  FOR EACH ROW EXECUTE FUNCTION fitmacro_set_updated_at();
--> statement-breakpoint

CREATE TRIGGER trg_set_updated_at BEFORE INSERT OR UPDATE ON "favourites"
  FOR EACH ROW EXECUTE FUNCTION fitmacro_set_updated_at();
--> statement-breakpoint

CREATE TRIGGER trg_set_updated_at BEFORE INSERT OR UPDATE ON "user_settings"
  FOR EACH ROW EXECUTE FUNCTION fitmacro_set_updated_at();
