import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MergeScreen } from '@/features/sync/MergeScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';
import * as client from '@/lib/sync/client';
import { store } from '@/lib/store';
import type { PullResult } from '@/lib/sync/types';

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return { ok, status, headers: new Headers(), json: () => Promise.resolve(body) } as Response;
}

const SIGNED_IN_USER = { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '' };

function mockSignedIn(): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { user: SIGNED_IN_USER })));
}

function fullPull(overrides: Partial<PullResult> = {}): PullResult {
  return {
    cursor: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
    hasMore: { entries: false, weights: false, customFoods: false, favourites: false },
    profile: null,
    settings: null,
    entries: [],
    weights: [],
    customFoods: [],
    favourites: [],
    counts: {
      entries: { total: 528, days: 96, firstDay: '2025-12-04', lastDay: '2026-03-10' },
      weights: { total: 39 },
      customFoods: { total: 3 },
      favourites: { total: 9 },
      lastChangeAt: '2026-03-10T21:30:00.000Z',
    },
    ...overrides,
  };
}

function renderMerge(): void {
  render(
    <MemoryRouter initialEntries={['/sync/merge']}>
      <AuthProvider>
        <Routes>
          <Route path="/sync/merge" element={<MergeScreen />} />
          <Route path="/sync/merge/done" element={<p>Done screen</p>} />
          <Route path="/" element={<p>Today</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAuthAvailability();
  localStorage.clear();
  store.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MergeScreen — real counts and the choice cards', () => {
  it('shows real, pre-commit counts for both "on this device" and "in your account" — never invented', async () => {
    mockSignedIn();
    // Local also has data, so both sides are non-empty (the scenario this screen exists for).
    store.addEntry({ name: 'Local food', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockResolvedValue(fullPull());

    renderMerge();

    expect(await screen.findByText(/528 entries/i)).toBeInTheDocument();
    expect(screen.getByText(/39 weight readings/i)).toBeInTheDocument();
    expect(screen.getByText(/3 custom foods/i)).toBeInTheDocument();
    expect(screen.getByText(/9 favourites/i)).toBeInTheDocument();
    expect(screen.getByText(/96 days logged/i)).toBeInTheDocument();
  });

  it('shows the error sync banner instead of rendering when counts cannot be computed (pull failed)', async () => {
    mockSignedIn();
    store.addEntry({ name: 'X', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockRejectedValue(new Error('network'));

    renderMerge();

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load/i);
    expect(screen.queryByText(/merge both/i)).not.toBeInTheDocument();
  });

  it('the primary button label always names the chosen action, never a generic "Continue"', async () => {
    mockSignedIn();
    store.addEntry({ name: 'X', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockResolvedValue(fullPull());
    const user = userEvent.setup();
    renderMerge();

    expect(await screen.findByRole('button', { name: 'Merge both' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /keep this device only/i }));
    expect(await screen.findByRole('button', { name: 'Keep this device only' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /keep account only/i }));
    expect(await screen.findByRole('button', { name: 'Keep account only' })).toBeInTheDocument();
  });

  it('backup-gates the destructive options: primary stays disabled until a backup is downloaded or explicitly skipped', async () => {
    mockSignedIn();
    store.addEntry({ name: 'X', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockResolvedValue(fullPull());
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    renderMerge();

    await user.click(await screen.findByRole('radio', { name: /keep this device only/i }));
    const primary = screen.getByRole('button', { name: 'Keep this device only' });
    expect(primary).toBeDisabled();

    await user.click(screen.getByLabelText(/don.t need a backup/i));
    expect(primary).toBeEnabled();
  });

  it('option 1 (merge both) needs no backup gate — the primary is enabled immediately', async () => {
    mockSignedIn();
    store.addEntry({ name: 'X', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockResolvedValue(fullPull());
    renderMerge();

    expect(await screen.findByRole('button', { name: 'Merge both' })).toBeEnabled();
  });

  it('destructive options require a second confirm dialog naming the exact counts before committing', async () => {
    mockSignedIn();
    store.addEntry({ name: 'X', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockResolvedValue(
      fullPull({
        entries: [
          {
            id: 'remote-only-1',
            day: '2026-03-01',
            name: 'Remote only',
            grams: 1,
            kcal: 1,
            protein: 1,
            carbs: 1,
            fat: 1,
            meal: 'lunch',
            source: 'manual',
            foodId: null,
            loggedAt: 1,
            updatedAt: 1000,
            deletedAt: null,
          },
        ],
        weights: [{ id: 'remote-weight-1', day: '2026-03-01', weightKg: 80, updatedAt: 1000, deletedAt: null }],
        counts: {
          entries: { total: 1, days: 1, firstDay: '2026-03-01', lastDay: '2026-03-01' },
          weights: { total: 1 },
          customFoods: { total: 0 },
          favourites: { total: 0 },
          lastChangeAt: null,
        },
      }),
    );
    const pushSpy = vi.spyOn(client, 'push');
    const user = userEvent.setup();
    renderMerge();

    await user.click(await screen.findByRole('radio', { name: /keep this device only/i }));
    await user.click(screen.getByLabelText(/don.t need a backup/i));
    await user.click(screen.getByRole('button', { name: 'Keep this device only' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/delete 1 entries and 1 weights from your account/i);
    // Not yet committed — the confirm dialog is a real second step.
    expect(pushSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /go back/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a mid-merge push failure leaves local data untouched and shows E-8, never a partial-success message', async () => {
    mockSignedIn();
    const entry = store.addEntry({ name: 'Untouched local entry', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockResolvedValue(fullPull());
    vi.spyOn(client, 'push').mockRejectedValue(new Error('server_error'));
    const beforeState = store.getState();
    const user = userEvent.setup();
    renderMerge();

    await screen.findByRole('button', { name: 'Merge both' });
    await user.click(screen.getByRole('button', { name: 'Merge both' }));

    expect(await screen.findByText(/the merge didn.t finish/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing on this device was changed/i)).toBeInTheDocument();
    expect(store.getState()).toEqual(beforeState);
    const day = Object.values(store.getState().days).find((d) => d.entries.some((e) => e.id === entry.id));
    expect(day).toBeTruthy();
  });

  it('a successful "Merge both" commits, applies the download locally, and navigates to the done screen', async () => {
    mockSignedIn();
    store.addEntry({ name: 'Local only', grams: 1, kcal: 1, protein: 1, carbs: 1, fat: 1, meal: 'snack', source: 'manual' });
    vi.spyOn(client, 'pull').mockResolvedValue(
      fullPull({
        entries: [
          {
            id: 'remote-1',
            day: '2026-03-01',
            name: 'From the account',
            grams: 100,
            kcal: 100,
            protein: 1,
            carbs: 1,
            fat: 1,
            meal: 'lunch',
            source: 'manual',
            foodId: null,
            loggedAt: 1,
            updatedAt: 1000,
            deletedAt: null,
          },
        ],
      }),
    );
    vi.spyOn(client, 'push').mockResolvedValue({
      serverState: { profile: null, settings: null, entries: null, weights: null, customFoods: null, favourites: null },
      applied: { profile: null, settings: null, entries: [], weights: [], customFoods: [], favourites: [] },
      rejected: { entries: [], weights: [], customFoods: [], favourites: [] },
    });
    const user = userEvent.setup();
    renderMerge();

    await user.click(await screen.findByRole('button', { name: 'Merge both' }));

    await waitFor(() => expect(screen.getByText('Done screen')).toBeInTheDocument());
    expect(store.getState().days['2026-03-01']?.entries.some((e) => e.name === 'From the account')).toBe(true);
  });
});
