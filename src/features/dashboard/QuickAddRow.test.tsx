import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAddRow } from '@/features/dashboard/QuickAddRow';
import { FOODS } from '@/data/foods';
import { store, selectDay } from '@/lib/store';
import { addDays, toDayKey } from '@/lib/date';

const today = toDayKey();

/** A real row from the shipped database, so `macrosForGrams` has something to scale. */
const chicken = FOODS.find((f) => f.id === 'chicken-breast');

function logged(foodId: string, grams: number, day: string): void {
  const food = FOODS.find((f) => f.id === foodId);
  if (!food) throw new Error(`test fixture missing food: ${foodId}`);
  store.addEntry(
    {
      foodId: food.id,
      name: food.name,
      grams,
      kcal: Math.round((food.kcal * grams) / 100),
      protein: 0,
      carbs: 0,
      fat: 0,
      meal: 'lunch',
      source: 'food-db',
    },
    day,
  );
}

function renderRow(): void {
  render(<QuickAddRow day={today} />);
}

beforeEach(() => {
  store.reset();
});

describe('QuickAddRow', () => {
  it('renders nothing at all when there is no history to offer', () => {
    const { container } = render(<QuickAddRow day={today} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a recently logged food at the portion last used', () => {
    if (!chicken) throw new Error('test fixture missing chicken-breast');
    logged(chicken.id, 150, addDays(today, -1));
    renderRow();

    const button = screen.getByRole('button', { name: new RegExp(chicken.name, 'i') });
    expect(button).toHaveTextContent('150 g');
  });

  it('logs the food to today on one tap, without leaving the screen', async () => {
    if (!chicken) throw new Error('test fixture missing chicken-breast');
    const user = userEvent.setup();
    logged(chicken.id, 150, addDays(today, -1));
    renderRow();

    await user.click(screen.getByRole('button', { name: new RegExp(chicken.name, 'i') }));

    const entries = selectDay(store.getState(), today).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.grams).toBe(150);
    expect(entries[0]?.foodId).toBe(chicken.id);
    // The confirmation is announced in place — a quick add must not navigate away.
    expect(screen.getByRole('status')).toHaveTextContent(new RegExp(chicken.name, 'i'));
  });

  it('lists each food once, newest first, at the portion last used', () => {
    // `selectRecentFoodRefs` de-duplicates on the entry's `loggedAt` clock, not on the
    // day it was filed under, so the three adds have to land on distinct timestamps —
    // in one synchronous tick they would tie and the first-seen portion would win.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-01T09:00:00Z'));
      logged('chicken-breast', 100, addDays(today, -3));
      vi.setSystemTime(new Date('2026-08-02T09:00:00Z'));
      logged('banana', 120, addDays(today, -2));
      vi.setSystemTime(new Date('2026-08-03T09:00:00Z'));
      logged('chicken-breast', 200, addDays(today, -1));
    } finally {
      vi.useRealTimers();
    }
    renderRow();

    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/chicken/i);
    expect(names[0]).toContain('200 g');
    expect(names[1]).toMatch(/banana/i);
  });

  it('drops a recent entry whose food no longer exists', () => {
    // A scanned entry has no foodId, so there is nothing to re-add it by.
    store.addEntry(
      {
        name: 'Photographed plate',
        grams: 300,
        kcal: 500,
        protein: 20,
        carbs: 50,
        fat: 15,
        meal: 'dinner',
        source: 'scan',
      },
      addDays(today, -1),
    );
    const { container } = render(<QuickAddRow day={today} />);
    expect(container).toBeEmptyDOMElement();
  });
});
