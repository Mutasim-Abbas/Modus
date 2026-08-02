import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Profile } from '@/types';
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  createId,
  createStore,
  defaultState,
  isFavourite,
  loadState,
  migrate,
  saveState,
  selectCustomFoods,
  selectDay,
  selectFavouriteIds,
  selectLiveWeights,
  selectLoggedDays,
  selectWeightForDay,
} from '@/lib/store';
import { calculateTargets } from '@/lib/macros';
import { toDayKey } from '@/lib/date';
import { V2_PAYLOAD } from '@/lib/__fixtures__/v2-payload';

const profile: Profile = {
  sex: 'male',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
};

const entry = {
  name: 'Chicken breast, cooked',
  grams: 150,
  kcal: 248,
  protein: 46.5,
  carbs: 0,
  fat: 5.4,
  meal: 'lunch' as const,
  source: 'food-db' as const,
  foodId: 'chicken-breast',
};

beforeEach(() => {
  localStorage.clear();
});

describe('defaultState', () => {
  it('starts empty at the current schema version', () => {
    const state = defaultState();
    expect(state).toEqual({
      version: SCHEMA_VERSION,
      profile: null,
      targets: null,
      days: {},
      weights: [],
      customFoods: [],
      favourites: [],
      settings: { units: 'metric', reducedMotion: false },
    });
  });
});

describe('persistence — the thing v1 got wrong', () => {
  it('writes to localStorage under the versioned key', () => {
    const store = createStore(defaultState());
    store.setProfile(profile);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ version: SCHEMA_VERSION });
  });

  it('survives a "refresh": a fresh store loads the previous profile and log', () => {
    const first = createStore(defaultState());
    first.setProfile(profile);
    first.addEntry(entry);

    // Simulate a page reload — brand new store reading from storage.
    const second = createStore(loadState());

    expect(second.getState().profile).toEqual(profile);
    expect(second.getState().targets).toEqual(calculateTargets(profile));
    expect(selectDay(second.getState(), toDayKey()).entries).toHaveLength(1);
    expect(selectDay(second.getState(), toDayKey()).entries[0]?.name).toBe(entry.name);
  });

  it('keeps entries across many reload cycles', () => {
    for (let i = 0; i < 3; i += 1) {
      const store = createStore(loadState());
      store.addEntry({ ...entry, name: `Meal ${i}` });
    }
    expect(selectDay(loadState(), toDayKey()).entries).toHaveLength(3);
  });

  it('reports isPersisted() false when localStorage throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    const store = createStore(defaultState());
    store.setProfile(profile);

    // The app must keep working in memory rather than crash.
    expect(store.getState().profile).toEqual(profile);
    expect(store.isPersisted()).toBe(false);
  });

  it('falls back to defaults when storage contains invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json at all');
    expect(loadState()).toEqual(defaultState());
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadState()).toEqual(defaultState());
  });
});

describe('migrate — untrusted input', () => {
  it('returns defaults for non-object payloads', () => {
    for (const bad of [null, undefined, 42, 'string', []]) {
      expect(migrate(bad)).toEqual(defaultState());
    }
  });

  it('stamps the current schema version onto older data', () => {
    expect(migrate({ version: 1, profile, days: {} }).version).toBe(SCHEMA_VERSION);
  });

  it('recomputes targets when they are missing but a profile exists', () => {
    const migrated = migrate({ version: SCHEMA_VERSION, profile, days: {} });
    expect(migrated.targets).toEqual(calculateTargets(profile));
  });

  it('drops a malformed profile rather than trusting it', () => {
    const migrated = migrate({
      version: SCHEMA_VERSION,
      profile: { sex: 'male', age: 0, heightCm: 0, weightKg: 0 },
      days: {},
    });
    expect(migrated.profile).toBeNull();
    expect(migrated.targets).toBeNull();
  });

  it('coerces unknown enum values to safe defaults', () => {
    const migrated = migrate({
      version: SCHEMA_VERSION,
      profile: { ...profile, sex: 'xx', activity: 'hyper', goal: 'shred' },
      days: {},
    });
    expect(migrated.profile?.sex).toBe('male');
    expect(migrated.profile?.activity).toBe('sedentary');
    expect(migrated.profile?.goal).toBe('maintain');
  });

  it('discards day keys that are not YYYY-MM-DD', () => {
    const migrated = migrate({
      version: SCHEMA_VERSION,
      days: { 'not-a-date': { entries: [] }, '2026-07-16': { entries: [] } },
    });
    expect(Object.keys(migrated.days)).toEqual(['2026-07-16']);
  });

  it('drops entries with no name and repairs missing ids', () => {
    const migrated = migrate({
      version: SCHEMA_VERSION,
      days: {
        '2026-07-16': {
          entries: [
            { name: '', kcal: 100 },
            { name: 'Valid food', kcal: 100, grams: 100 },
            'garbage',
          ],
        },
      },
    });

    const entries = migrated.days['2026-07-16']?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Valid food');
    expect(entries[0]?.id).toBeTruthy();
  });

  it('clamps negative macros in stored entries to zero', () => {
    const migrated = migrate({
      version: SCHEMA_VERSION,
      days: {
        '2026-07-16': {
          entries: [{ name: 'Weird', kcal: -500, protein: -10, carbs: NaN, fat: 5, grams: -1 }],
        },
      },
    });

    const stored = migrated.days['2026-07-16']?.entries[0];
    expect(stored?.kcal).toBe(0);
    expect(stored?.protein).toBe(0);
    expect(stored?.carbs).toBe(0);
    expect(stored?.grams).toBe(0);
    expect(stored?.fat).toBe(5);
  });

  it('salvages what it understands from a payload written by a newer version', () => {
    const migrated = migrate({
      version: SCHEMA_VERSION + 99,
      profile,
      days: { '2026-07-16': { entries: [{ name: 'Future food', kcal: 100, grams: 100 }] } },
      somethingNew: { we: 'do not know about' },
    });

    expect(migrated.profile).toEqual(profile);
    expect(migrated.days['2026-07-16']?.entries).toHaveLength(1);
  });

  it('round-trips a saved state without loss', () => {
    const store = createStore(defaultState());
    store.setProfile(profile);
    store.addEntry(entry);
    const before = store.getState();

    expect(migrate(JSON.parse(JSON.stringify(before)))).toEqual(before);
  });
});

describe('store mutations', () => {
  it('computes and stores targets when the profile is set', () => {
    const store = createStore(defaultState());
    store.setProfile(profile);
    expect(store.getState().targets).toEqual(calculateTargets(profile));
  });

  it('recomputes targets when the profile changes', () => {
    const store = createStore(defaultState());
    store.setProfile(profile);
    const before = store.getState().targets?.kcal ?? 0;

    store.setProfile({ ...profile, goal: 'cut' });
    expect(store.getState().targets?.kcal).toBeLessThan(before);
  });

  it('adds an entry with a generated id and timestamp', () => {
    const store = createStore(defaultState());
    const added = store.addEntry(entry);

    expect(added.id).toBeTruthy();
    expect(added.loggedAt).toBeGreaterThan(0);
    expect(selectDay(store.getState(), toDayKey()).entries).toEqual([added]);
  });

  it('gives every entry a unique id', () => {
    const store = createStore(defaultState());
    const ids = new Set(Array.from({ length: 50 }, () => store.addEntry(entry).id));
    expect(ids.size).toBe(50);
  });

  it('adds entries to a specific day', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, '2026-01-01');

    expect(selectDay(store.getState(), '2026-01-01').entries).toHaveLength(1);
    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
  });

  it('removes an entry by id', () => {
    const store = createStore(defaultState());
    const added = store.addEntry(entry);
    store.removeEntry(added.id);
    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
  });

  it('ignores removal of an unknown id or an empty day', () => {
    const store = createStore(defaultState());
    const before = store.getState();

    store.removeEntry('does-not-exist');
    store.removeEntry('does-not-exist', '2020-01-01');

    expect(store.getState()).toBe(before); // no needless re-render
  });

  it('treats state as immutable between commits', () => {
    const store = createStore(defaultState());
    const before = store.getState();
    store.addEntry(entry);
    expect(store.getState()).not.toBe(before);
    expect(before.days[toDayKey()]).toBeUndefined();
  });

  it('updates settings without touching the log', () => {
    const store = createStore(defaultState());
    store.addEntry(entry);
    store.setSettings({ reducedMotion: true });

    expect(store.getState().settings.reducedMotion).toBe(true);
    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(1);
  });
});

describe('subscriptions', () => {
  it('notifies subscribers on change', () => {
    const store = createStore(defaultState());
    const listener = vi.fn();
    store.subscribe(listener);

    store.addEntry(entry);
    expect(listener).toHaveBeenCalledTimes(1);

    store.setProfile(profile);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore(defaultState());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.addEntry(entry);
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies on reset', () => {
    const store = createStore(defaultState());
    const listener = vi.fn();
    store.subscribe(listener);

    store.reset();
    expect(listener).toHaveBeenCalled();
  });
});

describe('export and reset', () => {
  it('exports the full state as readable JSON', () => {
    const store = createStore(defaultState());
    store.setProfile(profile);
    store.addEntry(entry);

    const parsed = JSON.parse(store.exportJSON()) as AppState;
    expect(parsed.profile).toEqual(profile);
    expect(parsed.version).toBe(SCHEMA_VERSION);
    expect(parsed.days[toDayKey()]?.entries).toHaveLength(1);
  });

  it('reset clears both memory and storage', () => {
    const store = createStore(defaultState());
    store.setProfile(profile);
    store.addEntry(entry);

    store.reset();

    expect(store.getState()).toEqual(defaultState());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadState()).toEqual(defaultState());
  });
});

describe('selectors', () => {
  it('selectDay returns an empty day for a date with no entries', () => {
    expect(selectDay(defaultState(), '2026-01-01')).toEqual({ date: '2026-01-01', entries: [] });
  });

  it('selectLoggedDays returns days with entries, newest first', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, '2026-01-01');
    store.addEntry(entry, '2026-03-05');
    store.addEntry(entry, '2026-02-02');

    expect(selectLoggedDays(store.getState()).map((d) => d.date)).toEqual([
      '2026-03-05',
      '2026-02-02',
      '2026-01-01',
    ]);
  });

  it('selectLoggedDays skips days whose entries were all removed', () => {
    const store = createStore(defaultState());
    const added = store.addEntry(entry, '2026-01-01');
    store.removeEntry(added.id, '2026-01-01');

    expect(selectLoggedDays(store.getState())).toEqual([]);
  });
});

describe('saveState', () => {
  it('returns false instead of throwing when storage rejects the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(saveState(defaultState())).toBe(false);
  });
});

describe('createId — UUIDv7-style', () => {
  it('produces an RFC-4122-shaped id with version nibble 7', () => {
    const id = createId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createId()));
    expect(ids.size).toBe(200);
  });

  it('sorts chronologically as a plain string — the point of v7 over v4', async () => {
    const first = createId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = createId();
    expect(first < second).toBe(true);
  });
});

describe('updateEntry — edit a logged entry', () => {
  it('patches the requested fields and stamps updatedAt', () => {
    const store = createStore(defaultState());
    const added = store.addEntry(entry);
    const before = added.updatedAt;

    const updated = store.updateEntry(added.id, { grams: 200, kcal: 330 });

    expect(updated).not.toBeNull();
    expect(updated?.grams).toBe(200);
    expect(updated?.kcal).toBe(330);
    expect(updated?.name).toBe(entry.name); // untouched fields survive
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(before);
    expect(selectDay(store.getState(), toDayKey()).entries[0]?.grams).toBe(200);
  });

  it('can move an entry to a different meal slot', () => {
    const store = createStore(defaultState());
    const added = store.addEntry(entry); // meal: 'lunch'
    store.updateEntry(added.id, { meal: 'dinner' });

    expect(selectDay(store.getState(), toDayKey()).entries[0]?.meal).toBe('dinner');
  });

  it('returns null and does not commit for an unknown id', () => {
    const store = createStore(defaultState());
    const before = store.getState();

    expect(store.updateEntry('does-not-exist', { grams: 1 })).toBeNull();
    expect(store.getState()).toBe(before);
  });

  it('returns null for an entry that was already removed', () => {
    const store = createStore(defaultState());
    const added = store.addEntry(entry);
    store.removeEntry(added.id);

    expect(store.updateEntry(added.id, { grams: 1 })).toBeNull();
  });

  it('edits round-trip through a refresh', () => {
    const first = createStore(defaultState());
    const added = first.addEntry(entry, '2026-02-02');
    first.updateEntry(added.id, { name: 'Chicken breast, extra crispy', grams: 175 }, '2026-02-02');

    const second = createStore(loadState());
    const reloaded = selectDay(second.getState(), '2026-02-02').entries[0];
    expect(reloaded?.name).toBe('Chicken breast, extra crispy');
    expect(reloaded?.grams).toBe(175);
  });
});

describe('removeEntry — tombstone, not a hard delete', () => {
  it('keeps the row in storage (deletedAt set) so a future sync can propagate the delete', () => {
    const store = createStore(defaultState());
    const added = store.addEntry(entry, '2026-04-01');
    store.removeEntry(added.id, '2026-04-01');

    // Public read path (selectDay) hides it — this is the "removed" contract.
    expect(selectDay(store.getState(), '2026-04-01').entries).toHaveLength(0);
    // But the raw row survives with a tombstone, not spliced out.
    const raw = store.getState().days['2026-04-01']?.entries.find((e) => e.id === added.id);
    expect(raw).toBeDefined();
    expect(raw?.deletedAt).not.toBeNull();
  });
});

describe('backdating — logging on any day', () => {
  it('logs an entry on an arbitrary past day and it survives a refresh', () => {
    const first = createStore(defaultState());
    first.addEntry(entry, '2020-05-17');

    const second = createStore(loadState());
    expect(selectDay(second.getState(), '2020-05-17').entries).toHaveLength(1);
    expect(selectDay(second.getState(), toDayKey()).entries).toHaveLength(0);
  });
});

describe('copyDay — "copy yesterday"', () => {
  it('copies every live entry from one day onto another, as new rows', () => {
    const store = createStore(defaultState());
    const a = store.addEntry(entry, '2026-05-01');
    store.addEntry({ ...entry, name: 'Second meal' }, '2026-05-01');

    const copies = store.copyDay('2026-05-01', '2026-05-02');

    expect(copies).toHaveLength(2);
    expect(selectDay(store.getState(), '2026-05-02').entries.map((e) => e.name).sort()).toEqual(
      [entry.name, 'Second meal'].sort(),
    );
    // Fresh identities, not shared references to the source day's rows.
    expect(copies.every((c) => c.id !== a.id)).toBe(true);
    expect(selectDay(store.getState(), '2026-05-01').entries).toHaveLength(2); // source untouched
  });

  it('does not copy a tombstoned entry', () => {
    const store = createStore(defaultState());
    const added = store.addEntry(entry, '2026-05-01');
    store.removeEntry(added.id, '2026-05-01');

    expect(store.copyDay('2026-05-01', '2026-05-02')).toEqual([]);
  });

  it('appends to an existing target day rather than overwriting it', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, '2026-05-01');
    store.addEntry({ ...entry, name: 'Already there' }, '2026-05-02');

    store.copyDay('2026-05-01', '2026-05-02');

    expect(selectDay(store.getState(), '2026-05-02').entries).toHaveLength(2);
  });

  it('defaults the target day to today', () => {
    const store = createStore(defaultState());
    store.addEntry(entry, '2026-05-01');
    store.copyDay('2026-05-01');

    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(1);
  });

  it('is a no-op for a day with nothing logged', () => {
    const store = createStore(defaultState());
    const before = store.getState();

    expect(store.copyDay('2099-01-01', '2099-01-02')).toEqual([]);
    expect(store.getState()).toBe(before);
  });
});

describe('weights — the body-weight log', () => {
  it('logs a weigh-in for today by default', () => {
    const store = createStore(defaultState());
    const logged = store.logWeight(74.5);

    expect(logged.weightKg).toBe(74.5);
    expect(logged.day).toBe(toDayKey());
    expect(selectLiveWeights(store.getState())).toEqual([logged]);
  });

  it('upserts — a second weigh-in the same day replaces, not duplicates', () => {
    const store = createStore(defaultState());
    const first = store.logWeight(80, '2026-06-01');
    const second = store.logWeight(79.5, '2026-06-01');

    expect(second.id).toBe(first.id);
    expect(selectLiveWeights(store.getState())).toHaveLength(1);
    expect(selectWeightForDay(store.getState(), '2026-06-01')?.weightKg).toBe(79.5);
  });

  it('keeps distinct days as separate entries, sorted oldest first', () => {
    const store = createStore(defaultState());
    store.logWeight(80, '2026-06-03');
    store.logWeight(79, '2026-06-01');
    store.logWeight(79.5, '2026-06-02');

    expect(selectLiveWeights(store.getState()).map((w) => w.day)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
    ]);
  });

  it('removeWeight tombstones rather than deleting, and hides it from selectors', () => {
    const store = createStore(defaultState());
    const logged = store.logWeight(70, '2026-06-05');
    store.removeWeight(logged.id);

    expect(selectLiveWeights(store.getState())).toEqual([]);
    const raw = store.getState().weights.find((w) => w.id === logged.id);
    expect(raw?.deletedAt).not.toBeNull();
  });

  it('allows a new live weigh-in for a day once the previous one is removed', () => {
    const store = createStore(defaultState());
    const first = store.logWeight(70, '2026-06-05');
    store.removeWeight(first.id);
    const second = store.logWeight(71, '2026-06-05');

    expect(second.id).not.toBe(first.id);
    expect(selectLiveWeights(store.getState())).toEqual([second]);
  });

  it('removeWeight ignores an unknown id without committing', () => {
    const store = createStore(defaultState());
    const before = store.getState();
    store.removeWeight('does-not-exist');
    expect(store.getState()).toBe(before);
  });

  it('weigh-ins survive a refresh', () => {
    const first = createStore(defaultState());
    first.logWeight(68.2, '2026-06-10');

    const second = createStore(loadState());
    expect(selectWeightForDay(second.getState(), '2026-06-10')?.weightKg).toBe(68.2);
  });
});

describe('custom foods — user-entered, honestly labelled', () => {
  const custom = {
    name: 'Grandma’s bulgur pilaf',
    category: 'turkish & middle eastern' as const,
    kcal: 180,
    protein: 5,
    carbs: 32,
    fat: 4,
    per: 100 as const,
    commonPortions: [{ label: '1 bowl', grams: 250 }],
  };

  it('adds a custom food with a generated id', () => {
    const store = createStore(defaultState());
    const added = store.addCustomFood(custom);

    expect(added.id).toBeTruthy();
    expect(selectCustomFoods(store.getState())).toEqual([added]);
  });

  it('updates a custom food and stamps updatedAt', () => {
    const store = createStore(defaultState());
    const added = store.addCustomFood(custom);
    const updated = store.updateCustomFood(added.id, { kcal: 190 });

    expect(updated?.kcal).toBe(190);
    expect(updated?.name).toBe(custom.name);
  });

  it('returns null updating an unknown or removed custom food', () => {
    const store = createStore(defaultState());
    expect(store.updateCustomFood('nope', { kcal: 1 })).toBeNull();

    const added = store.addCustomFood(custom);
    store.removeCustomFood(added.id);
    expect(store.updateCustomFood(added.id, { kcal: 1 })).toBeNull();
  });

  it('removeCustomFood tombstones and hides it from selectCustomFoods', () => {
    const store = createStore(defaultState());
    const added = store.addCustomFood(custom);
    store.removeCustomFood(added.id);

    expect(selectCustomFoods(store.getState())).toEqual([]);
    const raw = store.getState().customFoods.find((f) => f.id === added.id);
    expect(raw?.deletedAt).not.toBeNull();
  });

  it('custom foods survive a refresh', () => {
    const first = createStore(defaultState());
    const added = first.addCustomFood(custom);

    const second = createStore(loadState());
    expect(selectCustomFoods(second.getState())).toEqual([added]);
  });
});

describe('favourites — toggle per food id', () => {
  it('toggles a food on, then off', () => {
    const store = createStore(defaultState());
    store.toggleFavourite('chicken-breast');
    expect(isFavourite(store.getState(), 'chicken-breast')).toBe(true);
    expect(selectFavouriteIds(store.getState())).toEqual(['chicken-breast']);

    store.toggleFavourite('chicken-breast');
    expect(isFavourite(store.getState(), 'chicken-breast')).toBe(false);
    expect(selectFavouriteIds(store.getState())).toEqual([]);
  });

  it('toggling back on reuses the row rather than duplicating it', () => {
    const store = createStore(defaultState());
    store.toggleFavourite('simit');
    store.toggleFavourite('simit');
    store.toggleFavourite('simit');

    expect(store.getState().favourites).toHaveLength(1);
    expect(isFavourite(store.getState(), 'simit')).toBe(true);
  });

  it('tracks multiple favourites independently', () => {
    const store = createStore(defaultState());
    store.toggleFavourite('chicken-breast');
    store.toggleFavourite('simit');

    expect(selectFavouriteIds(store.getState()).sort()).toEqual(['chicken-breast', 'simit']);
  });

  it('favourites survive a refresh', () => {
    const first = createStore(defaultState());
    first.toggleFavourite('hummus');

    const second = createStore(loadState());
    expect(isFavourite(second.getState(), 'hummus')).toBe(true);
  });
});

describe('migrate — v2 -> v3, a real captured payload, zero data loss', () => {
  it('preserves the profile exactly', () => {
    const migrated = migrate(structuredClone(V2_PAYLOAD));
    expect(migrated.profile).toEqual(V2_PAYLOAD.profile);
  });

  it('preserves computed targets exactly', () => {
    const migrated = migrate(structuredClone(V2_PAYLOAD));
    expect(migrated.targets).toEqual(V2_PAYLOAD.targets);
  });

  it('preserves settings exactly', () => {
    const migrated = migrate(structuredClone(V2_PAYLOAD));
    expect(migrated.settings).toEqual(V2_PAYLOAD.settings);
  });

  it('preserves every day and every entry on it — none dropped, none merged', () => {
    const migrated = migrate(structuredClone(V2_PAYLOAD));
    expect(Object.keys(migrated.days).sort()).toEqual(Object.keys(V2_PAYLOAD.days).sort());

    for (const [day, dayLog] of Object.entries(V2_PAYLOAD.days)) {
      expect(migrated.days[day]?.entries).toHaveLength(dayLog.entries.length);
    }
  });

  it('preserves every field of every entry — id, macros, meal, source, foodId, loggedAt', () => {
    const migrated = migrate(structuredClone(V2_PAYLOAD));

    for (const [day, dayLog] of Object.entries(V2_PAYLOAD.days)) {
      for (const original of dayLog.entries) {
        const found = migrated.days[day]?.entries.find((e) => e.id === original.id);
        expect(found, `entry ${original.id} on ${day} must survive migration`).toBeDefined();
        expect(found?.name).toBe(original.name);
        expect(found?.grams).toBe(original.grams);
        expect(found?.kcal).toBe(original.kcal);
        expect(found?.protein).toBe(original.protein);
        expect(found?.carbs).toBe(original.carbs);
        expect(found?.fat).toBe(original.fat);
        expect(found?.meal).toBe(original.meal);
        expect(found?.source).toBe(original.source);
        expect(found?.loggedAt).toBe(original.loggedAt);
        expect(found?.foodId).toBe('foodId' in original ? original.foodId : undefined);
      }
    }
  });

  it('backfills updatedAt from loggedAt (never edited) and deletedAt to null (never deleted)', () => {
    const migrated = migrate(structuredClone(V2_PAYLOAD));
    for (const dayLog of Object.values(migrated.days)) {
      for (const migratedEntry of dayLog.entries) {
        expect(migratedEntry.updatedAt).toBe(migratedEntry.loggedAt);
        expect(migratedEntry.deletedAt).toBeNull();
      }
    }
  });

  it('adds the three new v3 collections, empty, since v2 never had them', () => {
    const migrated = migrate(structuredClone(V2_PAYLOAD));
    expect(migrated.weights).toEqual([]);
    expect(migrated.customFoods).toEqual([]);
    expect(migrated.favourites).toEqual([]);
  });

  it('stamps the current schema version', () => {
    expect(migrate(structuredClone(V2_PAYLOAD)).version).toBe(SCHEMA_VERSION);
  });

  it('the migrated state actually loads through a real store — end to end', () => {
    // Write the captured v2 payload directly under the storage key a real browser
    // would have used, then boot a store the way the app does on startup.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(V2_PAYLOAD));
    const booted = createStore(loadState());

    expect(booted.getState().profile).toEqual(V2_PAYLOAD.profile);
    expect(selectDay(booted.getState(), '2026-07-20').entries).toHaveLength(2);
    expect(selectDay(booted.getState(), '2026-07-21').entries).toHaveLength(2);

    // And the migrated store is fully live: new v3 actions work immediately.
    booted.logWeight(61, '2026-07-22');
    expect(selectLiveWeights(booted.getState())).toHaveLength(1);
  });
});

describe('migrate — corrupt or partial payloads degrade safely, never throw', () => {
  it('a v2 payload with weights/customFoods/favourites already present (future-write edge case) is not corrupted', () => {
    const migrated = migrate({
      version: 2,
      profile: null,
      days: {},
      weights: [{ id: 'w1', day: '2026-01-01', weightKg: 70, updatedAt: 1, deletedAt: null }],
    });
    expect(migrated.weights).toHaveLength(1);
  });

  it('a half-written entry (missing macro fields) degrades to zeroed macros, not a crash', () => {
    expect(() =>
      migrate({ version: 2, days: { '2026-01-01': { entries: [{ name: 'Half-written' }] } } }),
    ).not.toThrow();

    const migrated = migrate({
      version: 2,
      days: { '2026-01-01': { entries: [{ name: 'Half-written' }] } },
    });
    const stored = migrated.days['2026-01-01']?.entries[0];
    expect(stored?.kcal).toBe(0);
    expect(stored?.deletedAt).toBeNull();
    expect(typeof stored?.updatedAt).toBe('number');
  });

  it('a weights array containing garbage entries drops only the garbage', () => {
    const migrated = migrate({
      version: 3,
      weights: [
        { day: '2026-01-01', weightKg: 70 },
        { day: 'not-a-date', weightKg: 70 },
        { day: '2026-01-02', weightKg: -5 }, // non-positive weight is invalid
        'garbage',
        null,
        42,
      ],
    });
    expect(migrated.weights).toHaveLength(1);
    expect(migrated.weights[0]?.day).toBe('2026-01-01');
  });

  it('a custom foods array with a nameless entry drops it, keeps the rest', () => {
    const migrated = migrate({
      version: 3,
      customFoods: [
        { name: '', kcal: 100 },
        { name: 'Valid', category: 'snacks', kcal: 100, protein: 1, carbs: 1, fat: 1 },
      ],
    });
    expect(migrated.customFoods).toHaveLength(1);
    expect(migrated.customFoods[0]?.name).toBe('Valid');
    expect(migrated.customFoods[0]?.per).toBe(100);
  });

  it('a favourites array with duplicate foodIds keeps only the most recently updated', () => {
    const migrated = migrate({
      version: 3,
      favourites: [
        { foodId: 'chicken-breast', updatedAt: 1 },
        { foodId: 'chicken-breast', updatedAt: 999 },
      ],
    });
    expect(migrated.favourites).toHaveLength(1);
    expect(migrated.favourites[0]?.updatedAt).toBe(999);
  });

  it('non-array weights/customFoods/favourites fields degrade to empty arrays, not a throw', () => {
    expect(() =>
      migrate({ version: 3, weights: 'nope', customFoods: {}, favourites: 42 }),
    ).not.toThrow();

    const migrated = migrate({ version: 3, weights: 'nope', customFoods: {}, favourites: 42 });
    expect(migrated.weights).toEqual([]);
    expect(migrated.customFoods).toEqual([]);
    expect(migrated.favourites).toEqual([]);
  });

  it('a completely garbage top-level payload still returns a usable default state', () => {
    for (const bad of [null, undefined, 'not json', 42, [], true]) {
      expect(() => migrate(bad)).not.toThrow();
      expect(migrate(bad)).toEqual(defaultState());
    }
  });

  it('a real store boots from a hand-corrupted localStorage blob without a white screen', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        profile: { sex: 'unknown-gender', age: -5, heightCm: 0, weightKg: 61 },
        days: { 'bad-key': {}, '2026-01-01': { entries: [{ name: 'ok', kcal: 100, grams: 100 }] } },
        weights: 'not-an-array',
      }),
    );

    expect(() => createStore(loadState())).not.toThrow();
    const booted = createStore(loadState());
    expect(booted.getState().profile).toBeNull(); // invalid profile (age <= 0) dropped
    expect(selectDay(booted.getState(), '2026-01-01').entries).toHaveLength(1);
    expect(booted.getState().weights).toEqual([]);
  });
});
