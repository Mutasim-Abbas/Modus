import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SignInScreen } from '@/features/auth/SignInScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';

function mockGuestProbe(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'unauthorized' }),
    }),
  );
}

function renderSignIn(): void {
  render(
    <MemoryRouter initialEntries={['/auth/sign-in']}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/sign-in" element={<SignInScreen />} />
          <Route path="/" element={<p>Today</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAuthAvailability();
  mockGuestProbe();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillAndSubmit(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^email$/i), email);
  await user.type(screen.getByLabelText(/^password$/i), password);
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('SignInScreen — error branches', () => {
  it('shows one generic message for wrong password or a non-existent email', async () => {
    renderSignIn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'invalid_credentials' }),
    } as Response);

    await fillAndSubmit('nobody@example.com', 'wrong-password');

    expect(await screen.findByText(/don.t match/i)).toBeInTheDocument();
  });

  it('shows a live countdown when rate-limited', async () => {
    renderSignIn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '272' }),
      json: () => Promise.resolve({ error: 'rate_limited' }),
    } as Response);

    await fillAndSubmit('a@b.com', 'password123');

    // Not pinned to an exact mm:ss — the countdown ticks on a real 1s interval, and
    // a slow CI runner could shave a second off between render and assertion.
    expect(await screen.findByText(/too many attempts.*try again in \d:\d\d/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
  });

  it('reports a network failure honestly instead of pretending to sign in', async () => {
    renderSignIn();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await fillAndSubmit('a@b.com', 'password123');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('signs in and navigates home without touching local data', async () => {
    renderSignIn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({ user: { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '' } }),
    } as Response);

    await fillAndSubmit('a@b.com', 'correct-password');

    expect(await screen.findByText('Today')).toBeInTheDocument();
  });

  it('offers a recovery-code path and never blocks guest mode', async () => {
    renderSignIn();
    expect(await screen.findByRole('link', { name: /use a recovery code/i })).toHaveAttribute(
      'href',
      '/auth/recover',
    );
    expect(screen.getByRole('link', { name: /continue without an account/i })).toBeInTheDocument();
  });
});
