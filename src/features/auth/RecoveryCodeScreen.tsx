import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/Button';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { useAuth } from '@/features/auth/AuthContext';
import { runAdoptionAndNavigate } from '@/features/sync/runAdoptionAndNavigate';
import { BRAND } from '@/lib/brand';

interface RecoveryCodeState {
  recoveryCode: string;
  email: string;
}

function isRecoveryCodeState(value: unknown): value is RecoveryCodeState {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).recoveryCode === 'string' &&
    typeof (value as Record<string, unknown>).email === 'string'
  );
}

/**
 * `/auth/recovery-code` (docs/DESIGN.md §7.9) — shown exactly once, immediately after
 * signup or a recovery-code redemption. The code arrives via this route's transient
 * `location.state`: it is never written to the store and never persisted to
 * localStorage/sessionStorage. It is captured into local component state once, on the
 * first render, then immediately stripped out of the browser's history entry (see the
 * effect below) — real `BrowserRouter` history, unlike the in-memory router used in
 * tests, persists `history.state` across a hard reload, so leaving the code sitting in
 * router state would let a refresh of this exact URL bring a "shown once" secret back.
 * Once stripped, there is no code path anywhere in this app that can retrieve it again.
 *
 * No "Skip". The screen is reached via `navigate(..., { replace: true })` from its
 * caller, so the sign-up/recovery form is not left behind in history to return to.
 */
export function RecoveryCodeScreen(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Signup/recovery-redeem both call `auth.signIn(user)` before navigating here, so a
  // signed-in user id is already available for the same post-sign-in adoption check
  // `SignInScreen` runs (docs/DESIGN.md §7.11, "Trigger").
  const continueHome = (): void => {
    if (auth.user) {
      void runAdoptionAndNavigate(navigate, auth.user.id);
    } else {
      navigate('/', { replace: true });
    }
  };

  // Captured once via the lazy initializer, from the location this component was FIRST
  // mounted with — stays stable even after the effect below clears `history.state`.
  const [state] = useState<RecoveryCodeState | null>(() =>
    isRecoveryCodeState(location.state) ? location.state : null,
  );

  useEffect(() => {
    if (!state) return;
    navigate(location.pathname, { replace: true, state: null });
    // Runs once, right after the code is captured above — not on every render, and not
    // keyed to `location`/`navigate` (which are recreated on the very navigation this
    // effect performs, which would otherwise re-trigger it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reached directly (a refresh, a bookmark, a second visit) with nothing to show —
  // the honest response is "there's nothing here", never a stale or fabricated code.
  if (!state) {
    return (
      <AuthLayout showContinueAsGuest={false}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-md bg-surface-2 text-gold">
            <AlertTriangle size={22} aria-hidden="true" />
          </span>
          <h1 className="text-lg font-bold text-white">Nothing to show here</h1>
          <p className="max-w-[34ch] text-sm leading-relaxed text-gray">
            Your recovery code is shown once, immediately after you create an account or redeem
            one. If you&rsquo;ve lost it, you can generate a new one from your account.
          </p>
          <Button className="mt-2 w-full" onClick={continueHome}>
            Go to Today
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(state.recoveryCode);
      setCopied(true);
    } catch {
      // Clipboard access can be denied/unavailable — the code stays fully visible and
      // selectable on screen either way, so this is a convenience, not the only path.
    }
  };

  const handleDownload = (): void => {
    const blob = new Blob([`${BRAND.name} recovery code for ${state.email}\n${state.recoveryCode}\n`], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modus-recovery-code.txt';
    link.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  return (
    <AuthLayout showContinueAsGuest={false}>
      <div className="mb-5">
        <h1 className="text-xl font-extrabold leading-tight text-white">Save your recovery code</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray">
          This is the only way back into your account if you forget your password. We can&rsquo;t
          email you a reset link.
        </p>
      </div>

      <div
        className="mb-4 rounded-md border-2 border-[color:var(--border-strong)] bg-surface-2 px-4 py-4 text-center"
        data-testid="recovery-code"
      >
        <span className="font-mono text-lg tracking-[0.06em] text-white">{state.recoveryCode}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => void handleCopy()}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy code'}
        </Button>
        <Button variant="secondary" onClick={handleDownload}>
          {downloaded ? <Check size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {downloaded ? 'Downloaded' : 'Download .txt'}
        </Button>
      </div>

      <label className="mb-4 flex cursor-pointer items-start gap-3 text-sm text-white">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--gold)]"
        />
        I&rsquo;ve saved my recovery code somewhere safe
      </label>

      <Button className="w-full" disabled={!acknowledged} onClick={continueHome}>
        Continue
      </Button>
    </AuthLayout>
  );
}
