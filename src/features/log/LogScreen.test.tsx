import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LogScreen } from '@/features/log/LogScreen';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { loadState, store } from '@/lib/store';
import { selectDay } from '@/lib/store';
import { toDayKey } from '@/lib/date';
import { AuthProvider } from '@/features/auth/AuthContext';

// Both LogScreen and DashboardScreen now render a `SyncChip` in their header
// (docs/DESIGN.md §7.10, Task 6), which reads `useAuth()` — every render here needs a
// real AuthProvider ancestor, the same way `src/features/profile/ProfileScreen.test.tsx`
// already does for its own Account section.

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

describe('LogScreen — search', () => {
  it('shows a prompt, not fake results, before a query is typed', () => {
    renderLog();
    // Scoped to the heading: the day's own empty state ("Nothing logged for Today")
    // also mentions "Search the food database" in its body copy.
    expect(screen.getByRole('heading', { name: /^search the food database$/i })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('finds foods as you type', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'chicken');

    const results = await screen.findAllByRole('button', { name: /chicken/i });
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds Turkish staples typed without accents', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'kunefe');
    // Anchored: the row's own favourite-toggle button also mentions the food's name.
    expect(await screen.findByRole('button', { name: /^künefe/i })).toBeInTheDocument();
  });

  it('shows an honest empty state for a query with no matches', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'zzzznotafood');
    expect(await screen.findByText(/no food matches/i)).toBeInTheDocument();
  });

  it('labels the database values as approximate reference values', () => {
    renderLog();
    expect(screen.getByText(/approximate reference values per 100 g/i)).toBeInTheDocument();
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.click(screen.getByRole('button', { name: /^dairy$/i }));
    expect(await screen.findByRole('button', { name: /^cheddar/i })).toBeInTheDocument();
  });
});

describe('LogScreen — the headline flow: search, portion, add', () => {
  it('opens a portion step showing macros scaled to the chosen weight', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'chicken breast');
    await user.click(await screen.findByRole('button', { name: /^chicken breast/i }));

    // 1 breast = 172 g of a 165 kcal/100 g food -> 284 kcal
    expect(await screen.findByRole('heading', { name: /chicken breast/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 breast/i })).toBeInTheDocument();
    expect(screen.getByText('284 kcal')).toBeInTheDocument();
  });

  it('recalculates when the portion changes', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'chicken breast');
    await user.click(await screen.findByRole('button', { name: /^chicken breast/i }));

    const portion = screen.getByLabelText(/^portion$/i);
    await user.clear(portion);
    await user.type(portion, '100');

    expect(await screen.findByText('165 kcal')).toBeInTheDocument();
  });

  it('adds the food to the log with correctly scaled macros', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'chicken breast');
    await user.click(await screen.findByRole('button', { name: /^chicken breast/i }));

    const portion = screen.getByLabelText(/^portion$/i);
    await user.clear(portion);
    await user.type(portion, '200');

    await user.click(screen.getByRole('button', { name: /add to/i }));

    const entries = selectDay(store.getState(), toDayKey()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      foodId: 'chicken-breast',
      grams: 200,
      kcal: 330, // 165 * 2
      protein: 62, // 31 * 2
      source: 'food-db',
    });
  });

  it('confirms the addition and returns to search so you can log another', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'banana');
    await user.click(await screen.findByRole('button', { name: /^banana/i }));
    await user.click(screen.getByRole('button', { name: /add to/i }));

    expect(await screen.findByText(/banana added to/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search foods/i)).toBeInTheDocument();
  });

  it('lets you back out of the portion step without logging anything', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'banana');
    await user.click(await screen.findByRole('button', { name: /^banana/i }));
    await user.click(screen.getByRole('button', { name: /back to search results/i }));

    expect(screen.getByLabelText(/search foods/i)).toBeInTheDocument();
    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
  });

  it('refuses to add an invalid portion', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'banana');
    await user.click(await screen.findByRole('button', { name: /^banana/i }));

    const portion = screen.getByLabelText(/^portion$/i);
    await user.clear(portion);

    expect(screen.getByRole('button', { name: /add to/i })).toBeDisabled();
    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
  });
});

describe('logging survives a refresh — the thing v1 got wrong', () => {
  it('a logged food is still on the dashboard after a full remount from storage', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'chicken breast');
    await user.click(await screen.findByRole('button', { name: /^chicken breast/i }));
    await user.click(screen.getByRole('button', { name: /add to/i }));

    // Prove the data is really in localStorage, not just in memory.
    const reloaded = loadState();
    expect(selectDay(reloaded, toDayKey()).entries).toHaveLength(1);
    expect(selectDay(reloaded, toDayKey()).entries[0]?.name).toMatch(/chicken breast/i);
  });

  it('the dashboard reflects logged food in its totals', async () => {
    const user = userEvent.setup();
    renderLog();

    await user.type(screen.getByLabelText(/search foods/i), 'chicken breast');
    await user.click(await screen.findByRole('button', { name: /^chicken breast/i }));
    const portion = screen.getByLabelText(/^portion$/i);
    await user.clear(portion);
    await user.type(portion, '100');
    await user.click(screen.getByRole('button', { name: /add to/i }));

    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardScreen />
        </AuthProvider>
      </MemoryRouter>,
    );

    /*
      v4 removed the "165 of 2711 kcal logged" subtitle from the Today header — the ring
      carries the fraction now. Asserting on the ring's accessible sentence rather than on
      the visible fraction is deliberate: that string is what a screen reader actually
      announces, so it is the canonical statement of the total and the one worth pinning.
    */
    expect(await screen.findByText(/calories:\s*165 of \d+ kcal/i)).toBeInTheDocument();
  });
});
