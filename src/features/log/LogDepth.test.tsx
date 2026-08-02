import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LogScreen } from '@/features/log/LogScreen';
import { HistoryScreen } from '@/features/history/HistoryScreen';
import { selectCustomFoods, selectDay, store } from '@/lib/store';
import { addDays, toDayKey } from '@/lib/date';
import { AuthProvider } from '@/features/auth/AuthContext';

// LogScreen renders a `SyncChip` in its header (docs/DESIGN.md §7.10, Task 6), which
// reads `useAuth()` — needs a real AuthProvider ancestor.

/**
 * P3.4 — Log depth: edit entries, backdate, custom foods, favourites/quick-add,
 * copy-yesterday. `LogScreen.test.tsx` keeps the original search/portion/add coverage;
 * this file covers everything added on top of it.
 */

const profile = {
  sex: 'male' as const,
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate' as const,
  goal: 'maintain' as const,
};

function renderLog(): void {
  render(
    <MemoryRouter>
      <AuthProvider>
        <LogScreen />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  store.reset();
  store.setProfile(profile);
});

describe('backdating', () => {
  it('logs to the previous day, not today, and it shows up on History', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.click(screen.getByRole('button', { name: 'Previous day' }));

    await user.type(screen.getByLabelText(/search foods/i), 'banana');
    await user.click(await screen.findByRole('button', { name: /^banana/i }));
    await user.click(screen.getByRole('button', { name: /add to/i }));

    const yesterday = addDays(toDayKey(), -1);
    expect(selectDay(store.getState(), yesterday).entries).toHaveLength(1);
    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);

    // LogScreen has its own "Yesterday" (the day-picker button), so it must come down
    // before History goes up — otherwise `getByText('Yesterday')` matches both and the
    // assertion cannot distinguish "History shows the backdated day" from "the Log screen
    // is still mounted". Scoped to History's own container for the same reason.
    cleanup();
    const history = render(
      <MemoryRouter>
        <HistoryScreen />
      </MemoryRouter>,
    );
    expect(within(history.container).getByText('Yesterday')).toBeInTheDocument();
    // The day is present because it has the entry we just backdated into it, not merely
    // because History renders a label for every recent day.
    expect(within(history.container).getByText(/105 kcal|1 entry/i)).toBeInTheDocument();
  });

  it("disables logging a day that hasn't happened yet", () => {
    renderLog();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
  });
});

describe('custom foods', () => {
  it('creates a custom food, marks it distinctly, and can log it', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.click(screen.getByRole('button', { name: /custom food/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'My protein shake');
    await user.type(screen.getByLabelText(/^calories$/i), '180');
    await user.type(screen.getByLabelText(/^protein$/i), '30');
    await user.type(screen.getByLabelText(/^carbs$/i), '5');
    await user.type(screen.getByLabelText(/^fat$/i), '2');
    await user.click(screen.getByRole('button', { name: /^add food$/i }));

    expect(await screen.findByText(/saved to your foods/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^mine/i })).toHaveAttribute('aria-pressed', 'true');

    // Visually distinguishable from a reference food — "Custom", never a category label.
    expect(screen.getByText(/custom · 180 kcal \/100 g/i)).toBeInTheDocument();

    const saved = selectCustomFoods(store.getState())[0];
    expect(saved?.name).toBe('My protein shake');

    await user.click(screen.getByRole('button', { name: /^my protein shake/i }));
    expect(
      screen.getByText(/based on the numbers you entered/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add to/i }));
    const entries = selectDay(store.getState(), toDayKey()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'My protein shake', foodId: saved?.id });
  });

  it('shows the empty state and lets you delete a custom food', async () => {
    const user = userEvent.setup();
    renderLog();

    expect(screen.queryByText(/no foods of your own yet/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^mine$/i }));
    expect(screen.getByText(/no foods of your own yet/i)).toBeInTheDocument();

    store.addCustomFood({
      name: 'Homemade granola',
      category: 'snacks',
      kcal: 450,
      protein: 10,
      carbs: 60,
      fat: 18,
      per: 100,
      commonPortions: [],
    });

    await user.click(screen.getByRole('button', { name: /^all$/i }));
    await user.click(screen.getByRole('button', { name: /^mine$/i }));

    await user.click(screen.getByRole('button', { name: /^delete homemade granola$/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(selectCustomFoods(store.getState())).toHaveLength(0);
    expect(screen.getByText(/no foods of your own yet/i)).toBeInTheDocument();
  });
});

describe('favourites & quick-add', () => {
  it('favourites a food from search, then quick-adds it from the Favourites view', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'banana');
    await user.click(screen.getByRole('button', { name: 'Add Banana to favourites' }));

    await user.clear(screen.getByLabelText(/search foods/i));
    await user.click(screen.getByRole('button', { name: /^favourites/i }));

    expect(screen.getByRole('button', { name: 'Remove Banana from favourites' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^\+ add \d+ g$/i }));

    const entries = selectDay(store.getState(), toDayKey()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'Banana', foodId: 'banana' });
  });

  it('shows the empty favourites state until something is starred', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.click(screen.getByRole('button', { name: /^favourites/i }));
    expect(screen.getByText(/no favourites yet/i)).toBeInTheDocument();
  });
});

describe('copy yesterday', () => {
  it('is disabled with nothing to copy', () => {
    renderLog();
    const chips = screen.getAllByRole('button', { name: /nothing logged yesterday/i });
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((chip) => expect(chip).toBeDisabled());
  });

  it('copies the previous day’s entries into today through the confirm sheet', async () => {
    const yesterday = addDays(toDayKey(), -1);
    store.addEntry(
      {
        name: 'Banana',
        grams: 118,
        kcal: 105,
        protein: 1.3,
        carbs: 27,
        fat: 0.4,
        meal: 'breakfast',
        source: 'food-db',
        foodId: 'banana',
      },
      yesterday,
    );

    const user = userEvent.setup();
    renderLog();

    const [copyChip] = screen.getAllByRole('button', { name: /^copy yesterday$/i });
    expect(copyChip).toBeDefined();
    await user.click(copyChip as HTMLElement);

    expect(await screen.findByText(/1 entry, 105 kcal/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^copy 1 entry$/i }));

    const entries = selectDay(store.getState(), toDayKey()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Banana');
  });
});

describe('edit and delete an already-logged entry', () => {
  it('edits a logged entry inline and rescales its macros', async () => {
    store.addEntry({
      name: 'Chicken breast, cooked',
      grams: 100,
      kcal: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
      meal: 'lunch',
      source: 'food-db',
      foodId: 'chicken-breast',
    });

    const user = userEvent.setup();
    renderLog();

    await user.click(screen.getByRole('button', { name: 'Edit Chicken breast, cooked' }));
    const portion = await screen.findByLabelText(/^portion$/i);
    await user.clear(portion);
    await user.type(portion, '200');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const entries = selectDay(store.getState(), toDayKey()).entries;
    expect(entries[0]).toMatchObject({ grams: 200, kcal: 330, protein: 62 });
  });

  it('deletes a logged entry after an inline confirmation', async () => {
    store.addEntry({
      name: 'Chicken breast, cooked',
      grams: 100,
      kcal: 165,
      protein: 31,
      carbs: 0,
      fat: 3.6,
      meal: 'lunch',
      source: 'food-db',
      foodId: 'chicken-breast',
    });

    const user = userEvent.setup();
    renderLog();

    await user.click(
      screen.getByRole('button', { name: 'Remove Chicken breast, cooked from Lunch' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/delete this entry/i);
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
  });
});
