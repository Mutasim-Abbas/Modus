import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ChangePasswordScreen } from '@/features/account/ChangePasswordScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return { ok, status, headers: new Headers(), json: () => Promise.resolve(body) } as Response;
}

const SIGNED_IN_USER = { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '' };

function renderChangePassword(): void {
  render(
    <MemoryRouter initialEntries={['/account/password']}>
      <AuthProvider>
        <Routes>
          <Route path="/account/password" element={<ChangePasswordScreen />} />
          <Route path="/account" element={<p>Account</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAuthAvailability();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { user: SIGNED_IN_USER })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillAndSubmit(current: string, next: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/current password/i), current);
  await user.type(screen.getByLabelText(/new password/i), next);
  await user.click(screen.getByRole('button', { name: /change password/i }));
}

describe('ChangePasswordScreen', () => {
  it('reports a wrong current password as a field-level error', async () => {
    renderChangePassword();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_credentials' }));

    await fillAndSubmit('wrong-current', 'a-new-password-1');

    expect(await screen.findByText(/not your current password/i)).toBeInTheDocument();
  });

  it('confirms success and states every other device was signed out', async () => {
    renderChangePassword();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));

    await fillAndSubmit('current-password-1', 'a-new-password-1');

    expect(await screen.findByText(/every other device has been signed out/i)).toBeInTheDocument();
  });

  it('shows a live countdown when rate-limited', async () => {
    renderChangePassword();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '120' }),
      json: () => Promise.resolve({ error: 'rate_limited' }),
    } as Response);

    await fillAndSubmit('current-password-1', 'a-new-password-1');

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });
});
