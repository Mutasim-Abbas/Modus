import { Link } from 'react-router-dom';
import { AlertTriangle, Check, CloudOff, RefreshCw, UserRound } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { useSyncEngineState } from '@/lib/sync/useSyncEngineState';
import { syncEngine } from '@/lib/sync/engine';
import { deriveSyncChipView } from '@/features/sync/syncChipView';
import { cn } from '@/lib/cn';

/**
 * The real `SyncChip` (docs/DESIGN.md §7.10 / §8.8). Reads `useAuth()` +
 * `useSyncEngineState()` directly — no provider needed for either, so this renders
 * correctly wherever it's mounted, including in isolated tests that never wrap a
 * `<SyncProvider>` (there isn't one) around it.
 */
export function SyncChip(): JSX.Element | null {
  const auth = useAuth();
  const engine = useSyncEngineState();
  const view = deriveSyncChipView(auth.status, engine);
  if (!view) return null;

  const COLORS: Record<Exclude<typeof view.state, undefined>, string> = {
    guest: 'text-gray-soft',
    synced: 'text-gray',
    syncing: 'text-gold',
    queued: 'text-fm-warn',
    error: 'text-fm-danger',
  };

  const Icon = {
    guest: UserRound,
    synced: Check,
    syncing: RefreshCw,
    queued: CloudOff,
    error: AlertTriangle,
  }[view.state];

  const liveRegion = view.state === 'error' ? 'assertive' : view.state === 'syncing' ? 'polite' : undefined;

  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-3 px-3 text-xs font-semibold',
        COLORS[view.state],
      )}
      role={liveRegion ? 'status' : undefined}
      aria-live={liveRegion}
    >
      <Icon size={14} aria-hidden="true" className={view.state === 'syncing' ? 'animate-spin' : undefined} />
      {view.text}
      {view.state === 'queued' && view.resumeHref ? (
        <Link to={view.resumeHref} className="underline underline-offset-2 hover:text-white">
          Resume
        </Link>
      ) : null}
      {view.state === 'error' ? (
        <button
          type="button"
          onClick={() => void syncEngine.syncNow()}
          className="ms-1 rounded-xs underline underline-offset-2 hover:text-white"
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}
