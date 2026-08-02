import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AccountScreen } from '@/features/account/AccountScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return { ok, status, headers: new Headers(), json: () => Promise.resolve(body) } as Response;
}

function renderAccount(): void {
  render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthProvider>
        <Routes>
          <Route path="/account" element={<AccountScreen />} />
          <Route path="/" element={<p>Today</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAuthAvailability();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountScreen — every guest/auth state', () => {
  it('redirects home when the deployment has no database configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { error: 'sync_unconfigured' })));
    renderAccount();
    expect(await screen.findByText('Today')).toBeInTheDocument();
  });

  it('shows the honest "not signed in" state for a guest, never a dead end', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));
    renderAccount();

    expect(await screen.findByText(/you.re not signed in/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create account/i })).toHaveAttribute('href', '/auth/sign-up');
    expect(screen.getByRole('link', { name: /^sign in$/i })).toHaveAttribute('href', '/auth/sign-in');
  });

  it('shows the signed-in email once authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { user: { id: 'u1', email: 'me@fitmacro.test', emailVerified: false, createdAt: '' } })),
    );
    renderAccount();
    expect(await screen.findByText('me@fitmacro.test')).toBeInTheDocument();
  });
});

describe('AccountScreen — sign out actions', () => {
  it('signs out of this device only, dropping to the guest empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { user: { id: 'u1', email: 'me@fitmacro.test', emailVerified: false, createdAt: '' } }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true })),
    );
    const user = userEvent.setup();
    renderAccount();
    await screen.findByText('me@fitmacro.test');

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(await screen.findByText(/you.re not signed in/i)).toBeInTheDocument();
  });

  it('signs out everywhere', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { user: { id: 'u1', email: 'me@fitmacro.test', emailVerified: false, createdAt: '' } }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true })),
    );
    const user = userEvent.setup();
    renderAccount();
    await screen.findByText('me@fitmacro.test');

    await user.click(screen.getByRole('button', { name: /sign out everywhere/i }));

    expect(await screen.findByText(/you.re not signed in/i)).toBeInTheDocument();
  });
});
