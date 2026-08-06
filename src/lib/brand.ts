/**
 * The product's user-facing identity, in one place.
 *
 * Changing `name` here changes every place the user reads it; nothing else hard-codes it.
 *
 * The rename from FitMacro reached the package, the repo and the deploy URL as well — but
 * deliberately *not* the two identifiers that are already live in production: the
 * localStorage keys (`fitmacro.v2`, `fitmacro.sync.v1`) and the Postgres trigger function
 * `fitmacro_set_updated_at()`. Those are addresses, not names. Renaming them orphans every
 * existing user's log, so they need a migration rather than a find/replace.
 */
export const BRAND = {
  name: 'Modus',
  tagline: 'Nutrition tracker',
  /** The gate's headline claim — the one sentence the product is arguing. */
  promise: 'Know what you ate. Not what an app guessed.',
  promiseSub:
    'Targets from a published formula, a food database you can read, and every number editable before it counts.',
} as const;
