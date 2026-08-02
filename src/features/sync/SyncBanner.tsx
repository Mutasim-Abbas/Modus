import { useState } from 'react';
import { AlertTriangle, CloudOff, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { useSyncEngineState } from '@/lib/sync/useSyncEngineState';
import { syncEngine } from '@/lib/sync/engine';
import { Button } from '@/components/Button';

/**
 * The two banner states docs/DESIGN.md §7.10 calls out — `queued` and `error` — shown
 * above the first card on every screen while signed in. Mounted once, in `<AppShell>`.
 * `queued` is dismissible for the session; `error` always offers `Retry` + `Details`
 * (the real error string — "no invented friendly lie").
 */
export function SyncBanner(): JSX.Element | null {
  const auth = useAuth();
  const engine = useSyncEngineState();
  const [dismissedQueued, setDismissedQueued] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  if (auth.status !== 'signed-in') return null;
  if (engine.postponed || engine.needsMerge) return null; // the merge screen owns this messaging

  if (engine.activity === 'error') {
    return (
      <div role="alert" className="mb-4 flex flex-col gap-2 rounded-md border border-fm-danger/40 bg-fm-danger-bg px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-fm-danger" aria-hidden="true" />
          <p className="flex-1 text-sm text-white">Couldn&rsquo;t sync. Your log is safe on this device.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void syncEngine.syncNow()}>
            Retry
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Hide details' : 'Details'}
          </Button>
        </div>
        {showDetails ? (
          <p className="rounded-xs bg-black/30 p-2 font-mono text-xs text-gray">
            {engine.lastErrorMessage ?? 'No further detail was returned.'}
          </p>
        ) : null}
      </div>
    );
  }

  if (engine.offline && engine.pendingCount > 0 && !dismissedQueued) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-md border border-fm-warn/40 bg-fm-warn-bg px-4 py-3">
        <CloudOff size={18} className="mt-0.5 shrink-0 text-fm-warn" aria-hidden="true" />
        <p className="flex-1 text-sm text-white">
          You&rsquo;re offline. {engine.pendingCount} change{engine.pendingCount === 1 ? ' is' : 's are'} saved here and
          will sync when you&rsquo;re back.
        </p>
        <button
          type="button"
          onClick={() => setDismissedQueued(true)}
          aria-label="Dismiss"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-xs text-gray-soft hover:text-white"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return null;
}
