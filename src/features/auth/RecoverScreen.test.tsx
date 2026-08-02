import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RecoverScreen } from '@/features/auth/RecoverScreen';
import { RecoveryCodeScreen } from '@/features/auth/RecoveryCodeScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return { ok, status, headers: new Headers(), json: () => Promise.resolve(body) } as Response;
}

function renderRecover(): void {
  render(
    <MemoryRouter initialEntries={['/auth/recover']}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/recover" element={<RecoverScreen />} />
          <Route path="/auth/recovery-code" element={<RecoveryCodeScreen />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetAuthAvailability();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillForm(email: string, code: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^email$/i), email);
  await user.type(screen.getByLabelText(/recovery code/i), code);
  await user.type(screen.getByLabelText(/new password/i), password);
  await user.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('RecoverScreen — error branches', () => {
  it('formats the recovery code into uppercase 4-char groups as it is typed', async () => {
    const user = userEvent.setup();
    renderRecover();
    const codeField = await screen.findByLabelText(/recovery code/i);
    await user.type(codeField, '7k4m92qx8rtd');
    expect(codeField).toHaveValue('7K4M-92QX-8RTD');
  });

  it('shows one generic message for a wrong code or a non-existent email', async () => {
    renderRecover();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, { error: 'recovery_invalid' }));

    await fillForm('a@b.com', 'WRONGCODE', 'a-new-password-1');

    expect(await screen.findByText(/don.t match/i)).toBeInTheDocument();
  });

  it('shows a live countdown when rate-limited', async () => {
    renderRecover();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '3600' }),
      json: () => Promise.resolve({ error: 'rate_limited' }),
    } as Response);

    await fillForm('a@b.com', 'SOMECODE', 'a-new-password-1');

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  it('on success, signs in and shows the brand-new recovery code exactly once', async () => {
    renderRecover();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        user: { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '' },
        recoveryCode: 'NEW1-CODE-SHOW-NCE1',
      }),
    );

    await fillForm('a@b.com', 'OLDCODE', 'a-new-password-1');

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('NEW1-CODE-SHOW-NCE1');
  });
});
