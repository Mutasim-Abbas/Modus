import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { useAppState } from '@/lib/useStore';
import { SyncChip } from '@/features/sync/SyncChip';

/**
 * Desktop top bar (≥1024px, docs/DESIGN.md §6.3). Sticky, glass, 64px. Shows the current
 * date, the real `SyncChip` (docs/DESIGN.md §7.10), and a link into Account (once
 * configured) or Profile.
 */
export function TopBar(): JSX.Element {
  const { profile } = useAppState();
  const auth = useAuth();
  const today = new Date();
  const dateLabel = today.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const signedIn = auth.status === 'signed-in';
  const initials = auth.user
    ? auth.user.email.slice(0, 1).toUpperCase()
    : profile
      ? profile.sex.slice(0, 1).toUpperCase()
      : '·';
  const accountHref = auth.status === 'unconfigured' ? '/profile' : '/account';

  return (
    <header className="fm-glass sticky top-0 z-20 flex h-16 items-center gap-4 px-6 [border-block-end:1px_solid_var(--fm-border)]">
      <span className="text-sm text-gray-soft" data-testid="top-bar-date">
        {dateLabel}
      </span>

      <span className="flex-1" />

      <SyncChip />

      <span className="inline-flex items-center rounded-xs bg-surface-2 px-2 py-1 text-xs font-semibold tracking-wide text-gray">
        EN
      </span>

      <Link
        to={accountHref}
        aria-label={signedIn ? 'Account' : 'Profile'}
        className="grid h-9 w-9 place-items-center rounded-full bg-surface-3 text-sm font-bold text-white transition-colors duration-200 ease-out hover:bg-surface-4"
      >
        {initials}
      </Link>
    </header>
  );
}
