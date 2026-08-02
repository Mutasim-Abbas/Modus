import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AuthErrorBanner } from '@/features/auth/AuthErrorBanner';
import { PasswordField } from '@/features/auth/PasswordField';
import { RateLimitNotice } from '@/features/auth/RateLimitNotice';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthError, deleteAccount } from '@/lib/authApi';
import { pullCounts, type SyncCounts } from '@/lib/syncApi';
import { useStore } from '@/lib/useStore';

const CONFIRM_WORD = 'DELETE';

type CountsState = { phase: 'loading' } | { phase: 'ready'; counts: SyncCounts } | { phase: 'error' };

/**
 * `/account/delete` (docs/DESIGN.md §7.9). Full-screen, danger-accented, never a small
 * modal. Real counts are fetched before the destructive confirmation is even offered —
 * `docs/DESIGN.md` §0 rule 8 forbids inventing data, including in a mockup-derived
 * screen. The backend contract (`docs/API.md`) requires the account's current password
 * on this call — the design mockup shows only the typed "DELETE" confirmation, but the
 * password field is added here because the frozen, tested backend genuinely requires it
 * (`POST /api/auth/delete-account` — "Requires a valid session cookie AND the current
 * password"). Deleting the account never touches this device's local store — the data
 * on this device stays, by design.
 */
export function DeleteAccountScreen(): JSX.Element {
  const navigate = useNavigate();
  const auth = useAuth();
  const store = useStore();
  const [countsState, setCountsState] = useState<CountsState>({ phase: 'loading' });
  const [exported, setExported] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [error, setError] = useState<AuthError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const loadCounts = (): void => {
    setCountsState({ phase: 'loading' });
    pullCounts()
      .then((counts) => setCountsState({ phase: 'ready', counts }))
      .catch(() => setCountsState({ phase: 'error' }));
  };

  useEffect(() => {
    if (auth.status === 'signed-in') loadCounts();
  }, [auth.status]);

  // Checked BEFORE the auth-status guards below: a successful delete calls
  // `auth.signOutLocally()`, which flips `auth.status` to 'guest' on this same render
  // pass — if the guards ran first they would redirect away before the confirmation
  // (with its "the data on this device stays" reassurance) ever had a chance to show.
  if (deleted) {
    return (
      <div className="flex flex-col gap-5">
        <ScreenHeader eyebrow="Account" title="Account deleted" />
        <Card className="flex flex-col gap-3">
          <p role="status" className="text-sm leading-relaxed text-white">
            Your account and everything synced to it are gone. The data on this device stays —
            FitMacro keeps working offline with your local log.
          </p>
          <Button onClick={() => navigate('/', { replace: true })}>Go to Today</Button>
        </Card>
      </div>
    );
  }

  // 'loading' is not a rejection — the boot probe (GET /api/auth/me) simply hasn't
  // resolved yet. Redirecting on it would bounce a genuinely signed-in user straight
  // back to /account before their own session was ever confirmed.
  if (auth.status === 'loading') {
    return (
      <p role="status" className="p-4 text-sm text-gray">
        Checking your session…
      </p>
    );
  }
  if (auth.status !== 'signed-in') return <Navigate to="/account" replace />;

  const handleExport = (): void => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fitmacro-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setExported(true);
  };

  const retryAfterSeconds =
    error?.kind === 'rate_limited' && error.retryAfterSeconds !== null ? error.retryAfterSeconds : null;

  const canSubmit = password.length > 0 && confirmText === CONFIRM_WORD;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPasswordError(undefined);
    setSubmitting(true);
    try {
      await deleteAccount(password);
      // Local data is never touched here — `deleteAccount` only calls the server;
      // nothing in this handler imports or calls `src/lib/store.ts`.
      auth.signOutLocally();
      setDeleted(true);
    } catch (cause) {
      const authError = cause instanceof AuthError ? cause : new AuthError('server', 'Unexpected failure.');
      if (authError.kind === 'invalid_credentials') {
        setPasswordError("That's not your password.");
      } else {
        auth.handleAuthError(authError);
        setError(authError);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader eyebrow="Account" title="Delete your account" />

      <Card className="flex flex-col gap-3 border-[color:var(--danger)]/40">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <p className="text-sm font-semibold text-white">
            This deletes your account and everything synced to it:
          </p>
        </div>

        {countsState.phase === 'loading' ? (
          <p role="status" className="text-xs text-gray">
            Loading your account totals…
          </p>
        ) : null}

        {countsState.phase === 'error' ? (
          <div className="flex flex-col gap-2">
            <AuthErrorBanner message="Couldn't load your account totals. Try again before deleting." />
            <Button size="sm" variant="secondary" onClick={loadCounts}>
              Retry
            </Button>
          </div>
        ) : null}

        {countsState.phase === 'ready' ? (
          <ul className="ms-4 list-disc text-xs leading-relaxed text-gray">
            <li>{countsState.counts.entries.total} food entries</li>
            <li>{countsState.counts.weights.total} weight readings</li>
            <li>{countsState.counts.customFoods.total} custom foods</li>
            <li>your profile and targets</li>
          </ul>
        ) : null}

        <p className="text-xs leading-relaxed text-gray">
          It cannot be undone. We do not keep a copy.
        </p>
        <p className="text-xs font-semibold leading-relaxed text-white">
          The data on this device stays. You&rsquo;ll be signed out and FitMacro keeps working
          offline with your local log.
        </p>
      </Card>

      <Button variant="secondary" className="w-full" onClick={handleExport}>
        <Download size={16} aria-hidden="true" />
        {exported ? 'Export saved' : 'Export my data first (.json)'}
      </Button>

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <PasswordField
          label="Your password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={passwordError}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="delete-confirm" className="text-sm font-semibold text-white">
            Type DELETE to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            className="min-h-[48px] w-full rounded-md border border-[color:var(--border)] bg-black-soft px-4 text-[15px] text-white focus:border-[color:var(--border-strong)]"
            autoComplete="off"
          />
        </div>

        {error && retryAfterSeconds === null ? (
          <AuthErrorBanner message="Couldn't delete your account. Try again." />
        ) : null}
        {retryAfterSeconds !== null ? <RateLimitNotice retryAfterSeconds={retryAfterSeconds} /> : null}

        <Button
          type="submit"
          variant="danger"
          className="w-full"
          disabled={!canSubmit || submitting || retryAfterSeconds !== null}
          aria-busy={submitting}
        >
          <Trash2 size={18} aria-hidden="true" />
          {submitting ? 'Deleting…' : 'Delete my account'}
        </Button>

        <Button type="button" variant="ghost" className="w-full" onClick={() => navigate('/account')}>
          Cancel
        </Button>
      </form>
    </div>
  );
}
