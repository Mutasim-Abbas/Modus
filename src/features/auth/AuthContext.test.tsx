import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthError } from '@/lib/authApi';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';
import { store } from '@/lib/store';

function mockFetch(status: number, body: unknown, ok = status >= 200 && status < 300): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      headers: new Headers(),
      json: () => Promise.resolve(body),
    }),
  );
}

function Probe(): JSX.Element {
  const auth = useAuth();
  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      <p data-testid="email">{auth.user?.email ?? ''}</p>
      <button onClick={() => auth.signIn({ id: 'u1', email: 'me@fitmacro.test', emailVerified: false, createdAt: '' })}>
        sign-in
      </button>
      <button onClick={() => auth.handleAuthError(new AuthError('unauthorized', 'expired'))}>
        simulate-401
      </button>
      <button onClick={() => auth.handleAuthError(new AuthError('sync_unconfigured', 'off'))}>
        simulate-unconfigured
      </button>
    </div>
  );
}

beforeEach(() => {
  resetAuthAvailability();
  store.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthContext — boot probe', () => {
  it('resolves to signed-in when GET /api/auth/me succeeds', async () => {
    mockFetch(200, { user: { id: 'u1', email: 'me@fitmacro.test', emailVerified: false, createdAt: '' } });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('signed-in')).toBeInTheDocument();
    expect(screen.getByTestId('email')).toHaveTextContent('me@fitmacro.test');
  });

  it('resolves to guest on 401 — guest mode is the default, never a wall', async () => {
    mockFetch(401, { error: 'unauthorized' });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('guest')).toBeInTheDocument();
  });

  it('resolves to unconfigured on 503 sync_unconfigured — this hides auth entirely', async () => {
    mockFetch(503, { error: 'sync_unconfigured' });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('unconfigured')).toBeInTheDocument();
  });

  it('fails open to guest on a network error — a flaky connection must never block guest mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('guest')).toBeInTheDocument();
  });
});

describe('AuthContext — a 401 mid-session drops to guest without losing local data', () => {
  it('clears the signed-in user but never touches the local store', async () => {
    mockFetch(401, { error: 'unauthorized' });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('guest');

    // Prove there is real local data before the 401 arrives.
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
    expect(Object.keys(beforeState.days).length).toBeGreaterThan(0);

    // Sign in locally (simulating a prior successful login), then simulate a mid-session
    // 401 from some later authenticated call (e.g. GET /api/auth/me on a refresh, or
    // change-password against an expired session).
    await user.click(screen.getByRole('button', { name: 'sign-in' }));
    expect(await screen.findByText('signed-in')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'simulate-401' }));
    expect(await screen.findByText('guest')).toBeInTheDocument();
    expect(screen.getByTestId('email')).toHaveTextContent('');

    // Local data survived the drop to guest, byte for byte.
    expect(store.getState()).toEqual(beforeState);
  });
});

describe('AuthContext — sync_unconfigured hides auth entirely', () => {
  it('an unauthorized error observed elsewhere does not override an already-known unconfigured state incorrectly, and vice versa', async () => {
    mockFetch(200, { user: { id: 'u1', email: 'me@fitmacro.test', emailVerified: false, createdAt: '' } });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('signed-in')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'simulate-unconfigured' }));
    expect(await screen.findByText('unconfigured')).toBeInTheDocument();
    expect(screen.getByTestId('email')).toHaveTextContent('');
  });
});

describe('AuthContext — no token in storage', () => {
  it('never writes to localStorage or sessionStorage while booting or changing auth state', async () => {
    const localSetItem = vi.spyOn(Storage.prototype, 'setItem');
    mockFetch(200, { user: { id: 'u1', email: 'me@fitmacro.test', emailVerified: false, createdAt: '' } });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signed-in');
    await user.click(screen.getByRole('button', { name: 'simulate-401' }));
    await screen.findByText('guest');

    // Nothing in the boot probe, sign-in, or the 401 drop-to-guest path ever calls
    // Storage.setItem — the session is the cookie, full stop.
    expect(localSetItem).not.toHaveBeenCalled();
  });
});
