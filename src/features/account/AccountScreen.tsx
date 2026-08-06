import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CloudOff, KeyRound, LogOut, Monitor, RefreshCw, ShieldAlert, UserRoundPlus } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AuthErrorBanner } from '@/features/auth/AuthErrorBanner';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthError, logout, logoutAll } from '@/lib/authApi';
import { SyncChip } from '@/features/sync/SyncChip';
import { useSyncEngineState } from '@/lib/sync/useSyncEngineState';
import { syncEngine } from '@/lib/sync/engine';
import { formatRelativeTime } from '@/lib/sync/relativeTime';
import { BRAND } from '@/lib/brand';

/**
 * `/account` (docs/DESIGN.md §7.9). Guest mode is never blocked — a signed-out visitor
 * sees the same honest E-1 empty state as the Profile screen's Account slot, never a
 * dead end. `sync_unconfigured` redirects home instead of rendering at all, mirroring
 * how `/auth/*` behaves for the same deployment state.
 */
export function AccountScreen(): JSX.Element {
  const auth = useAuth();
  const [busy, setBusy] = useState<'logout' | 'logout-all' | null>(null);
  const [error, setError] = useState<AuthError | null>(null);

  if (auth.status === 'unconfigured') return <Navigate to="/" replace />;

  if (auth.status === 'loading') {
    return (
      <div className="flex flex-col gap-5">
        <ScreenHeader eyebrow="Account" title="Account & sync" />
        <p role="status" className="text-sm text-gray">
          Checking your session…
        </p>
      </div>
    );
  }

  if (auth.status === 'guest') {
    return (
      <div className="flex flex-col gap-5">
        <ScreenHeader eyebrow="Account" title="Account & sync" />
        <EmptyState
          icon={UserRoundPlus}
          title="You're not signed in"
          description={`${BRAND.name} is saving everything on this device. Create an account and your log follows you to your phone, laptop and back.`}
          action={
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <LinkButton to="/auth/sign-up" className="flex-1">
                Create account
              </LinkButton>
              <LinkButton to="/auth/sign-in" variant="secondary" className="flex-1">
                Sign in
              </LinkButton>
            </div>
          }
        />
      </div>
    );
  }

  const { user } = auth;

  const handleLogout = async (): Promise<void> => {
    setError(null);
    setBusy('logout');
    try {
      await logout();
      auth.signOutLocally();
    } catch (cause) {
      const authError = cause instanceof AuthError ? cause : new AuthError('server', 'Unexpected failure.');
      // logout is documented as always 200 — a failure here means the network/server
      // itself is unreachable, not that the session survived. Either way, the session
      // cookie for THIS device may or may not still be valid; the honest move is to
      // report the failure rather than silently pretending it worked.
      setError(authError);
    } finally {
      setBusy(null);
    }
  };

  const handleLogoutAll = async (): Promise<void> => {
    setError(null);
    setBusy('logout-all');
    try {
      await logoutAll();
      auth.signOutLocally();
    } catch (cause) {
      const authError = cause instanceof AuthError ? cause : new AuthError('server', 'Unexpected failure.');
      auth.handleAuthError(authError);
      setError(authError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader eyebrow="Account" title="Account & sync" />

      {error ? (
        <AuthErrorBanner
          message={
            error.kind === 'unauthorized'
              ? "You've already been signed out — your session had expired."
              : "Couldn't reach the server. Try again."
          }
        />
      ) : null}

      <section aria-labelledby="signed-in-as">
        <h2 id="signed-in-as" className="mb-2 text-base font-bold text-white">
          Signed in as
        </h2>
        <Card className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{user?.email}</p>
            {user && !user.emailVerified ? (
              <span className="mt-1 inline-flex items-center rounded-xs bg-surface-3 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray">
                Not verified
              </span>
            ) : null}
          </div>
        </Card>
      </section>

      <SyncSection />

      <section aria-labelledby="devices">
        <h2 id="devices" className="mb-2 text-base font-bold text-white">
          Devices
        </h2>
        <Card className="flex flex-col gap-3">
          <p className="flex gap-2 text-xs leading-relaxed text-gray">
            <Monitor size={15} className="mt-0.5 shrink-0 text-gray-soft" aria-hidden="true" />
            Sign out of just this device, or end every signed-in session everywhere.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => void handleLogout()}
              disabled={busy !== null}
              aria-busy={busy === 'logout'}
            >
              <LogOut size={16} aria-hidden="true" />
              {busy === 'logout' ? 'Signing out…' : 'Sign out'}
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => void handleLogoutAll()}
              disabled={busy !== null}
              aria-busy={busy === 'logout-all'}
            >
              <ShieldAlert size={16} aria-hidden="true" />
              {busy === 'logout-all' ? 'Signing out…' : 'Sign out everywhere'}
            </Button>
          </div>
        </Card>
      </section>

      <section aria-labelledby="security">
        <h2 id="security" className="mb-2 text-base font-bold text-white">
          Security
        </h2>
        <Card className="flex flex-col gap-2">
          <LinkButton to="/account/password" variant="secondary" className="w-full">
            <KeyRound size={16} aria-hidden="true" />
            Change password
          </LinkButton>
          <LinkButton to="/auth/recover" variant="secondary" className="w-full">
            New recovery code
          </LinkButton>
          <p className="text-xs leading-relaxed text-gray-soft">
            Your recovery code was shown once at sign-up. If you&rsquo;ve lost it, use your current
            recovery code to get a new one — the old one stops working the moment you do.
          </p>
        </Card>
      </section>

      <section aria-labelledby="danger-zone">
        <h2 id="danger-zone" className="mb-2 text-base font-bold text-white">
          Danger zone
        </h2>
        <Card>
          <LinkButton to="/account/delete" variant="danger" className="w-full">
            Delete account
          </LinkButton>
        </Card>
      </section>
    </div>
  );
}

/**
 * The real Sync card (docs/DESIGN.md §7.10): the `SyncChip`, the last-sync time, and a
 * `Sync now` button that calls the engine directly. If the adoption/merge decision was
 * postponed (or was never resolved for some other reason), this offers a way back to
 * `/sync/merge` instead of silently doing nothing forever.
 */
function SyncSection(): JSX.Element {
  const engine = useSyncEngineState();
  const needsAttention = engine.postponed || engine.needsMerge;

  return (
    <section aria-labelledby="sync">
      <h2 id="sync" className="mb-2 text-base font-bold text-white">
        Sync
      </h2>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <SyncChip />
          {!needsAttention ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void syncEngine.syncNow()}
              disabled={engine.activity === 'syncing'}
            >
              <RefreshCw size={14} aria-hidden="true" className={engine.activity === 'syncing' ? 'animate-spin' : undefined} />
              Sync now
            </Button>
          ) : null}
        </div>
        {needsAttention ? (
          <div className="flex items-start gap-2">
            <CloudOff size={16} className="mt-0.5 shrink-0 text-fm-warn" aria-hidden="true" />
            <div className="flex flex-col gap-2">
              <p className="text-xs leading-relaxed text-gray">
                You chose to finish this later — your log stays on this device until you decide how to combine it
                with your account.
              </p>
              <LinkButton to="/sync/merge" variant="secondary" className="w-fit">
                Finish combining your data
              </LinkButton>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-gray">
            {engine.lastSyncedAt !== null
              ? `Last synced ${formatRelativeTime(engine.lastSyncedAt)}.`
              : 'Nothing has synced yet.'}
          </p>
        )}
      </Card>
    </section>
  );
}
