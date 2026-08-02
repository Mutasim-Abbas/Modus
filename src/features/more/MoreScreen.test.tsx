import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MoreScreen } from '@/features/more/MoreScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { resetAuthAvailability } from '@/features/auth/authAvailability';
import { store } from '@/lib/store';

function mockMe(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: () => Promise.resolve(body),
    }),
  );
}

function renderMore(): void {
  render(
    <MemoryRouter>
      <AuthProvider>
        <MoreScreen />
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

describe('MoreScreen — Account row mirrors sync_unconfigured exactly like ai_unconfigured hides Scan', () => {
  it('hides auth entirely when the deployment has no database (503 sync_unconfigured)', async () => {
    mockMe(503, { error: 'sync_unconfigured' });
    renderMore();

    expect(await screen.findByText(/accounts aren.t set up on this deployment/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /account & sync/i })).not.toBeInTheDocument();
  });

  it('offers sign in / create account when configured but signed out', async () => {
    mockMe(401, { error: 'unauthorized' });
    renderMore();

    expect(await screen.findByRole('link', { name: /sign in \/ create account/i })).toHaveAttribute(
      'href',
      '/account',
    );
  });

  it('shows the real Account & sync row once signed in', async () => {
    mockMe(200, { user: { id: 'u1', email: 'a@b.com', emailVerified: false, createdAt: '' } });
    renderMore();

    expect(await screen.findByRole('link', { name: /account & sync/i })).toHaveAttribute('href', '/account');
  });
});
