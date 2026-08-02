import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HistoryScreen } from '@/features/history/HistoryScreen';
import { store } from '@/lib/store';
import { toDayKey } from '@/lib/date';

const profile = {
  sex: 'male' as const,
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate' as const,
  goal: 'maintain' as const,
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
};

function renderHistory(): void {
  render(
    <MemoryRouter>
      <HistoryScreen />
    </MemoryRouter>,
  );
}

/** Yesterday's key, derived rather than hard-coded so the test never rots. */
function yesterdayKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toDayKey(date);
}

beforeEach(() => {
  store.reset();
  store.setProfile(profile);
});

describe('HistoryScreen', () => {
  it('shows a real empty state, not fabricated past days', () => {
    renderHistory();

    expect(screen.getByText(/no days logged yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log your first food/i })).toBeInTheDocument();
  });

  it('lists a logged day with its totals', async () => {
    store.addEntry(entry);
    renderHistory();

    expect(await screen.findByText('Today')).toBeInTheDocument();
    // The summary row carries the day's calorie total (the most recent day is
    // expanded by default, so scope to the header button rather than the whole tree).
    const summary = screen.getByRole('button', { name: /today/i });
    expect(within(summary).getByText('248')).toBeInTheDocument();
    expect(within(summary).getByText(/1 item/i)).toBeInTheDocument();
  });

  it('labels today and yesterday in plain language', () => {
    store.addEntry(entry);
    store.addEntry(entry, yesterdayKey());
    renderHistory();

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('orders days newest first', () => {
    store.addEntry(entry, '2026-01-01');
    store.addEntry(entry, '2026-03-05');
    renderHistory();

    // Each day is an <h2> containing its toggle button, so heading order is day order.
    const labels = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    const marchIndex = labels.findIndex((l) => l.includes('Mar'));
    const janIndex = labels.findIndex((l) => l.includes('Jan'));

    expect(marchIndex).toBeGreaterThanOrEqual(0);
    expect(janIndex).toBeGreaterThanOrEqual(0);
    expect(marchIndex).toBeLessThan(janIndex);
  });

  it('expands a day to reveal its entries', async () => {
    const user = userEvent.setup();
    store.addEntry(entry, '2026-01-01');
    store.addEntry(entry);
    renderHistory();

    const janButton = screen.getByRole('button', { name: /jan/i });
    expect(janButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(janButton);
    expect(janButton).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText(/chicken breast/i)).toBeInTheDocument();
  });

  it('counts only days that still have entries', () => {
    const added = store.addEntry(entry, '2026-01-01');
    store.removeEntry(added.id, '2026-01-01');
    renderHistory();

    expect(screen.getByText(/no days logged yet/i)).toBeInTheDocument();
  });
});
