import type { NavigateFunction } from 'react-router-dom';
import { runPostSignInAdoption } from '@/lib/sync/signInFlow';
import { pushToast } from '@/lib/toast';

/**
 * Shared by `SignInScreen` and `RecoveryCodeScreen` — the two places a device can land
 * on `/` freshly signed in for the first time this session (docs/DESIGN.md §7.11,
 * "Trigger"). Sync failure here must never block navigation (the app's overall
 * "degrades to local-only, never blocks" rule extends to sign-in itself) — any error
 * from the adoption check is swallowed and treated as "nothing to do right now"; the
 * background engine (started once `<AppShell>` mounts) will pick sync back up on its
 * own, and `/account` always offers a manual retry.
 */
export async function runAdoptionAndNavigate(navigate: NavigateFunction, userId: string): Promise<void> {
  try {
    const outcome = await runPostSignInAdoption(userId);
    if (outcome.kind === 'needs-merge') {
      navigate('/sync/merge', { replace: true });
      return;
    }
    if (outcome.kind === 'silent-upload') {
      pushToast(`Your ${outcome.counts.entries.total} logged entries are now syncing to your account.`);
    } else if (outcome.kind === 'silent-download') {
      pushToast(`Your account's data (${outcome.counts.entries.total} entries) is now on this device.`);
    }
  } catch {
    // Fail open — see doc comment above.
  }
  navigate('/', { replace: true });
}
