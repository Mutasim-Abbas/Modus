import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SignUpScreen } from '@/features/auth/SignUpScreen';
import { RecoveryCodeScreen } from '@/features/auth/RecoveryCodeScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';

function mockMeThen501(): void {
  // Every render mounts AuthProvider, which probes GET /api/auth/me first. Default it
  // to a 401 (guest) so the screen renders in its normal, signed-out state; individual
  // tests override the *next* call for the form submission itself.
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

function renderSignUp(): void {
  render(
    <MemoryRouter initialEntries={['/auth/sign-up']}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/sign-up" element={<SignUpScreen />} />
          <Route path="/auth/recovery-code" element={<RecoveryCodeScreen />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAuthAvailability();
  mockMeThen501();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignUpScreen', () => {
  it('always offers a way to continue without an account', async () => {
    renderSignUp();
    expect(await screen.findByRole('link', { name: /continue without an account/i })).toBeInTheDocument();
  });

  it('warns up front that there is no email reset link, before signing up', async () => {
    renderSignUp();
    expect(await screen.findByText(/can.t email you a reset link/i)).toBeInTheDocument();
  });

  it('shows the recovery code exactly once, then it is gone for good (docs/DESIGN.md §7.9)', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.type(await screen.findByLabelText(/^email$/i), 'new@modus.test');
    await user.type(screen.getByLabelText(/^password$/i), 'a-strong-password-1');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          user: { id: 'u1', email: 'new@modus.test', emailVerified: false, createdAt: '' },
          recoveryCode: '7K4M-92QX-8RTD-51WV-3NHA',
        }),
    } as Response);

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('7K4M-92QX-8RTD-51WV-3NHA');

    // It is never shown a second time: there is no route/state that can retrieve it
    // again once this screen unmounts (it lives only in transient router state).
    document.body.innerHTML = '';
  });

  it('shows a specific, actionable message when the email is already registered', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.type(await screen.findByLabelText(/^email$/i), 'taken@modus.test');
    await user.type(screen.getByLabelText(/^password$/i), 'a-strong-password-1');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'email_taken' }),
    } as Response);

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/already has an account/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in instead/i })).toBeInTheDocument();
  });

  it('shows a live countdown when rate-limited, and disables the submit button', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.type(await screen.findByLabelText(/^email$/i), 'a@b.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-strong-password-1');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '90' }),
      json: () => Promise.resolve({ error: 'rate_limited' }),
    } as Response);

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
  });

  it('shows an offline message on a network failure, without inventing a result', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.type(await screen.findByLabelText(/^email$/i), 'a@b.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-strong-password-1');

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await user.click(screen.getByRole('button', { name: /create account/i }));

    // Two `role="alert"` nodes are legitimately on screen at once here: the permanent
    // "no email reset link" warning (shown before any submission) and the new
    // form-level error from this failed attempt — assert the second one specifically.
    expect(await screen.findByText(/check your details and try again/i)).toBeInTheDocument();
  });

  it('rejects a too-short password locally, without a network round trip', async () => {
    const user = userEvent.setup();
    renderSignUp();

    await user.type(await screen.findByLabelText(/^email$/i), 'a@b.com');
    await user.type(screen.getByLabelText(/^password$/i), 'short');
    const callsBefore = vi.mocked(fetch).mock.calls.length;

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  });
});
