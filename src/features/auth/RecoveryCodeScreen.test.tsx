import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RecoveryCodeScreen } from '@/features/auth/RecoveryCodeScreen';
import { AuthProvider } from '@/features/auth/AuthContext';

// RecoveryCodeScreen's "Continue"/"Go to Today" now reads `useAuth()` directly to run
// the post-sign-in adoption check (docs/DESIGN.md §7.11, Task 6) — needs a real
// AuthProvider ancestor. `fetch` is left unmocked deliberately, exactly like
// `src/app/App.test.tsx` already does: it fails open to guest (no user), so
// `continueHome()` takes its plain "navigate home" branch, same as before this screen
// depended on auth at all.
function renderRecoveryCode(state?: unknown): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/auth/recovery-code', state }]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/recovery-code" element={<RecoveryCodeScreen />} />
          <Route path="/" element={<p>Today</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecoveryCodeScreen — shown exactly once', () => {
  it('shows the code carried in router state, mono, and never as a "Skip"-able screen', () => {
    renderRecoveryCode({ recoveryCode: '7K4M-92QX-8RTD-51WV-3NHA', email: 'a@b.com' });

    expect(screen.getByTestId('recovery-code')).toHaveTextContent('7K4M-92QX-8RTD-51WV-3NHA');
    expect(screen.queryByRole('link', { name: /continue without an account/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('disables Continue until the save-acknowledgement checkbox is ticked', async () => {
    const user = userEvent.setup();
    renderRecoveryCode({ recoveryCode: 'ABCD-EFGH-JKMN-PQRS-TVWX', email: 'a@b.com' });

    const continueButton = screen.getByRole('button', { name: /continue/i });
    expect(continueButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(continueButton).toBeEnabled();

    await user.click(continueButton);
    expect(await screen.findByText('Today')).toBeInTheDocument();
  });

  it('shows nothing — never a stale or reconstructed code — when reached without state (a refresh)', () => {
    renderRecoveryCode(undefined);

    expect(screen.queryByTestId('recovery-code')).not.toBeInTheDocument();
    expect(screen.getByText(/nothing to show here/i)).toBeInTheDocument();
  });

  it('copies the code to the clipboard on request', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // `userEvent.setup()` installs its own clipboard emulation on `navigator.clipboard`
    // (for its `user.copy()`/`user.paste()` helpers), so a stub installed *before* it is
    // silently overwritten. Defining ours after `setup()` (and after `vi.stubGlobal('navigator', ...)`
    // fails the same way jsdom's non-configurable accessor would) is the reliable order.
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderRecoveryCode({ recoveryCode: 'ABCD-EFGH-JKMN-PQRS-TVWX', email: 'a@b.com' });

    await user.click(screen.getByRole('button', { name: /copy code/i }));

    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH-JKMN-PQRS-TVWX');
    expect(await screen.findByText(/^copied$/i)).toBeInTheDocument();
  });

  it('downloads the code as a .txt file on request', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    renderRecoveryCode({ recoveryCode: 'ABCD-EFGH-JKMN-PQRS-TVWX', email: 'a@b.com' });

    await user.click(screen.getByRole('button', { name: /download \.txt/i }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
