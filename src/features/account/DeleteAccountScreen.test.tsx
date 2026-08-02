import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DeleteAccountScreen } from '@/features/account/DeleteAccountScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';
import { store } from '@/lib/store';

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as Response;
}

const SIGNED_IN_USER = { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '' };
const COUNTS_BODY = {
  counts: {
    entries: { total: 42, days: 10, firstDay: '2026-01-01', lastDay: '2026-02-01' },
    weights: { total: 6 },
    customFoods: { total: 2 },
    favourites: { total: 1 },
    lastChangeAt: '2026-02-01T00:00:00.000Z',
  },
};

function mockSignedInWithCounts(): void {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      // 1: AuthProvider's boot probe, GET /api/auth/me
      .mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }))
      // 2: DeleteAccountScreen's pullCounts(), GET /api/sync/pull
      .mockResolvedValueOnce(jsonResponse(200, COUNTS_BODY)),
  );
}

function renderDeleteAccount(): void {
  render(
    <MemoryRouter initialEntries={['/account/delete']}>
      <AuthProvider>
        <Routes>
          <Route path="/account/delete" element={<DeleteAccountScreen />} />
          <Route path="/account" element={<p>Account</p>} />
          <Route path="/" element={<p>Today</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAuthAvailability();
  store.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeleteAccountScreen — requires an explicit confirmation', () => {
  it('shows real, fetched counts before any destructive action is offered', async () => {
    mockSignedInWithCounts();
    renderDeleteAccount();

    expect(await screen.findByText(/42 food entries/i)).toBeInTheDocument();
    expect(screen.getByText(/6 weight readings/i)).toBeInTheDocument();
    expect(screen.getByText(/2 custom foods/i)).toBeInTheDocument();
  });

  it('keeps Delete disabled until both the password is filled and DELETE is typed exactly', async () => {
    mockSignedInWithCounts();
    const user = userEvent.setup();
    renderDeleteAccount();
    await screen.findByText(/42 food entries/i);

    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    expect(deleteButton).toBeDisabled();

    await user.type(screen.getByLabelText(/your password/i), 'my-password');
    expect(deleteButton).toBeDisabled();

    await user.type(screen.getByLabelText(/type delete to confirm/i), 'delete');
    expect(deleteButton).toBeDisabled(); // case-sensitive — lowercase must not satisfy it

    await user.clear(screen.getByLabelText(/type delete to confirm/i));
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE');
    expect(deleteButton).toBeEnabled();
  });

  it('deletes the account, never touches local data, and states the device keeps its log', async () => {
    mockSignedInWithCounts();
    const user = userEvent.setup();
    renderDeleteAccount();
    await screen.findByText(/42 food entries/i);

    store.addEntry({
      name: 'Chicken breast',
      grams: 150,
      kcal: 248,
      protein: 46,
      carbs: 0,
      fat: 5,
      meal: 'lunch',
      source: 'manual',
    });
    const beforeState = store.getState();

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await user.type(screen.getByLabelText(/your password/i), 'my-password');
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE');
    await user.click(screen.getByRole('button', { name: /delete my account/i }));

    expect(await screen.findByText(/account deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/data on this device stays/i)).toBeInTheDocument();
    expect(store.getState()).toEqual(beforeState);
  });

  it('reports a wrong password as a field-level error, not a generic failure', async () => {
    mockSignedInWithCounts();
    const user = userEvent.setup();
    renderDeleteAccount();
    await screen.findByText(/42 food entries/i);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_credentials' }, false));

    await user.type(screen.getByLabelText(/your password/i), 'wrong-password');
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE');
    await user.click(screen.getByRole('button', { name: /delete my account/i }));

    expect(await screen.findByText(/not your password/i)).toBeInTheDocument();
  });

  it('shows a live countdown when rate-limited', async () => {
    mockSignedInWithCounts();
    const user = userEvent.setup();
    renderDeleteAccount();
    await screen.findByText(/42 food entries/i);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '60' }),
      json: () => Promise.resolve({ error: 'rate_limited' }),
    } as Response);

    await user.type(screen.getByLabelText(/your password/i), 'my-password');
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE');
    await user.click(screen.getByRole('button', { name: /delete my account/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });
});
