import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Download } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useAuth } from '@/features/auth/AuthContext';
import { store } from '@/lib/store';
import { pull, push } from '@/lib/sync/client';
import { computeMergePreview, resolveKeepAccountOnly, resolveKeepDeviceOnly, resolveMergeBoth } from '@/lib/sync/adoption';
import type { MergePreview } from '@/lib/sync/adoption';
import { applyPushResultToAcked, foldRemoteAppliedIntoAcked } from '@/lib/sync/diff';
import { loadAccountSyncState, saveAccountSyncState } from '@/lib/sync/persist';
import type { PullResult } from '@/lib/sync/types';
import { BRAND } from '@/lib/brand';

type Option = 'merge-both' | 'keep-device' | 'keep-account';

type Phase = 'loading' | 'error' | 'ready' | 'committing' | 'failed';

interface DoneSummary {
  added: { entries: number; weights: number; customFoods: number; favourites: number };
  keptNewer: number;
  deleted: { entries: number; weights: number };
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtWhen(iso: string | null): string {
  if (!iso) return 'no changes yet';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function ComparisonCard({ title, counts }: { title: string; counts: MergePreview['local'] }): JSX.Element {
  return (
    <Card className="flex flex-col gap-1.5">
      <h3 className="mb-1 text-sm font-bold text-white">{title}</h3>
      <p className="text-sm text-gray">{counts.entries.days} days logged</p>
      {counts.entries.firstDay ? (
        <p className="text-xs text-gray-soft">
          {fmtDate(counts.entries.firstDay)} – {fmtDate(counts.entries.lastDay)}
        </p>
      ) : null}
      <p className="text-sm text-gray">{counts.entries.total} entries</p>
      <p className="text-sm text-gray">{counts.weights.total} weight readings</p>
      <p className="text-sm text-gray">{counts.customFoods.total} custom foods</p>
      <p className="text-sm text-gray">{counts.favourites.total} favourites</p>
      <p className="mt-1 text-xs text-gray-soft">Last change: {fmtWhen(counts.lastChangeAt)}</p>
    </Card>
  );
}

/**
 * `/sync/merge` — the adoption/merge screen (docs/DESIGN.md §7.11). The highest-risk
 * screen in v3: every number here is real and computed before commit (rule 1), the
 * primary button's label always names the chosen action (rule 2), destructive options
 * are backup-gated (rule 3) and require a second, exact-count confirmation (rule 4),
 * and a mid-merge failure leaves local data completely untouched (rule 7/9, E-8).
 *
 * Deliberately does its OWN fresh full pull on mount rather than trusting anything
 * passed through router state — docs/DESIGN.md requires this route to survive a
 * refresh/back-button re-entry, so it must be self-sufficient.
 */
export function MergeScreen(): JSX.Element | null {
  const auth = useAuth();
  const navigate = useNavigate();
  const legendId = useId();
  const [phase, setPhase] = useState<Phase>('loading');
  const [committingLabel, setCommittingLabel] = useState('');
  const [data, setData] = useState<{ remote: PullResult; preview: MergePreview } | null>(null);
  const [option, setOption] = useState<Option>('merge-both');
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [skipBackup, setSkipBackup] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = (): void => {
    setPhase('loading');
    pull(null)
      .then((remote) => {
        const local = store.getState();
        const preview = computeMergePreview(local, remote);
        setData({ remote, preview });
        setPhase('ready');
      })
      .catch(() => setPhase('error'));
  };

  useEffect(() => {
    load();
    // Block the browser back button from silently leaving an unresolved merge —
    // pressing back re-enters this same route instead (docs/DESIGN.md §7.11,
    // "the browser back button re-enters it").
    window.history.pushState(null, '', window.location.href);
    const onPopState = (): void => {
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (auth.status === 'loading') return <p className="p-6 text-sm text-gray">Checking your session…</p>;
  if (auth.status !== 'signed-in') return <Navigate to="/" replace />;

  const handleBackup = (): void => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `modus-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupDownloaded(true);
  };

  const decideLater = (): void => {
    saveAccountSyncState(auth.user?.id ?? '', { ...loadAccountSyncState(auth.user?.id ?? ''), postponed: true });
    navigate('/', { replace: true });
  };

  const commit = async (remote: PullResult, preview: MergePreview): Promise<void> => {
    const userId = auth.user?.id ?? '';
    const local = store.getState();

    try {
      if (option === 'merge-both') {
        setCommittingLabel('Merging your data…');
        setPhase('committing');
        const plan = resolveMergeBoth(local, remote, preview);
        const pushResult = await push(plan.pushBody);
        // Only now — after the server has acknowledged — is the local store rewritten.
        store.replaceSyncedState(plan.localPatch);
        let sync = applyPushResultToAcked(loadAccountSyncState(userId), plan.manifest, pushResult);
        // Rows the REMOTE side won during this merge are now sitting in the local store
        // with the server's own `updatedAt` — ack them too, or they read as dirty on the
        // very next sync cycle and get pushed straight back (the internal security audit F-16).
        if (plan.remoteApplied) sync = { ...sync, acked: foldRemoteAppliedIntoAcked(sync.acked, plan.remoteApplied) };
        try {
          const confirmPull = await pull(null);
          sync = { ...sync, pullCursor: confirmPull.cursor };
        } catch {
          /* the merge itself already succeeded; a stale/null cursor just costs one
             extra full pull on the next background cycle — not a failure of this screen */
        }
        sync = { ...sync, resolved: true, postponed: false, lastSyncedAt: Date.now() };
        saveAccountSyncState(userId, sync);

        const addedEntries = preview.deltas.entries.localOnlyLive.length;
        const addedWeights = preview.deltas.weights.localOnlyLive.length;
        navigate('/sync/merge/done', {
          replace: true,
          state: {
            added: {
              entries: addedEntries,
              weights: addedWeights,
              customFoods: preview.deltas.customFoods.localOnlyLive.length,
              favourites: preview.deltas.favourites.localOnlyLive.length,
            },
            keptNewer: preview.conflicts.length,
            deleted: { entries: 0, weights: 0 },
          } satisfies DoneSummary,
        });
        return;
      }

      if (option === 'keep-device') {
        setCommittingLabel('Uploading this device’s data…');
        setPhase('committing');
        const plan = resolveKeepDeviceOnly(local, remote);
        const pushResult = await push(plan.pushBody);
        let sync = applyPushResultToAcked(loadAccountSyncState(userId), plan.manifest, pushResult);
        try {
          const confirmPull = await pull(null);
          sync = { ...sync, pullCursor: confirmPull.cursor };
        } catch {
          /* see above */
        }
        sync = { ...sync, resolved: true, postponed: false, lastSyncedAt: Date.now() };
        saveAccountSyncState(userId, sync);

        navigate('/sync/merge/done', {
          replace: true,
          state: {
            added: { entries: 0, weights: 0, customFoods: 0, favourites: 0 },
            keptNewer: 0,
            deleted: {
              entries: preview.deltas.entries.remoteOnlyLive.length,
              weights: preview.deltas.weights.remoteOnlyLive.length,
            },
          } satisfies DoneSummary,
        });
        return;
      }

      // keep-account: a pure local replacement — the source data is the full pull
      // already fetched successfully when this screen loaded, so there is no further
      // network step that can fail partway through.
      setCommittingLabel('Applying your account’s data…');
      setPhase('committing');
      const plan = resolveKeepAccountOnly(local, remote);
      store.replaceSyncedState(plan.localPatch);
      saveAccountSyncState(userId, {
        ...loadAccountSyncState(userId),
        pullCursor: remote.cursor,
        resolved: true,
        postponed: false,
        lastSyncedAt: Date.now(),
        profileSnapshot: plan.localPatch.profile ?? null,
        settingsSnapshot: plan.localPatch.settings ?? null,
      });

      navigate('/sync/merge/done', {
        replace: true,
        state: {
          added: { entries: 0, weights: 0, customFoods: 0, favourites: 0 },
          keptNewer: 0,
          deleted: {
            entries: preview.deltas.entries.localOnlyLive.length,
            weights: preview.deltas.weights.localOnlyLive.length,
          },
        } satisfies DoneSummary,
      });
    } catch (cause) {
      // E-8: "Nothing on this device was changed and nothing was deleted." True here
      // because every branch above only calls `store.replaceSyncedState` AFTER its
      // network step already succeeded (or, for keep-account, needed no network step
      // that could fail after the pull already used to build the preview).
      void cause;
      setPhase('failed');
    }
  };

  const primaryLabel = option === 'merge-both' ? 'Merge both' : option === 'keep-device' ? 'Keep this device only' : 'Keep account only';

  if (phase === 'loading' || (phase === 'ready' && !data)) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-[720px] flex-col justify-center gap-4 p-6">
        <p role="status" className="text-sm text-gray">
          Comparing this device with your account…
        </p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-[720px] flex-col justify-center gap-4 p-6">
        <div role="alert" className="flex flex-col gap-3 rounded-md border border-fm-danger/40 bg-fm-danger-bg p-4">
          <p className="text-sm text-white">Couldn&rsquo;t load your account&rsquo;s data to compare. Nothing was changed.</p>
          <Button onClick={load}>Retry</Button>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-[720px] flex-col justify-center gap-4 p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-fm-danger/40 px-6 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-md bg-surface-2 text-fm-danger">
            <AlertTriangle size={22} aria-hidden="true" />
          </span>
          <h1 className="text-base font-bold text-white">The merge didn&rsquo;t finish</h1>
          <p className="max-w-[38ch] text-sm leading-relaxed text-gray">
            Nothing on this device was changed and nothing was deleted. Your log is exactly as it was.
          </p>
          <div className="flex gap-2">
            <Button onClick={load}>Try again</Button>
            <Button variant="ghost" onClick={decideLater}>
              Decide later
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Defensive only — every reachable path to here (`ready`/`committing`) sets `data`
  // before the phase transition that gets us past the guards above.
  if (!data) return null;
  const { remote, preview } = data;
  const committing = phase === 'committing';

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[900px] flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-extrabold text-white">Your data is in two places</h1>
        <p className="mt-1.5 text-sm text-gray">Sign-in never deletes anything. Choose how to put them together.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ComparisonCard title="On this device" counts={preview.local} />
        <ComparisonCard title="In your account" counts={preview.remote} />
      </div>

      <div>
        <Button variant="secondary" className="w-full" onClick={handleBackup} disabled={committing}>
          <Download size={16} aria-hidden="true" />
          {backupDownloaded ? 'Backup saved' : "Download a backup of this device's data (.json)"}
        </Button>
        {backupDownloaded ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-fm-ok">
            <Check size={13} aria-hidden="true" /> Backup saved
          </p>
        ) : null}
      </div>

      <fieldset aria-busy={committing} className="flex flex-col gap-3 border-0 p-0" disabled={committing}>
        <legend id={legendId} className="mb-1 text-sm font-bold text-white">
          Choose one
        </legend>

        <ChoiceCard
          name={legendId}
          value="merge-both"
          selected={option === 'merge-both'}
          onSelect={() => setOption('merge-both')}
          title="Merge both"
          badge="RECOMMENDED"
        >
          <p className="text-sm text-gray">
            Keep everything from both places. Where the same entry was changed in both, the newer change is kept.
          </p>
          <p className="mt-1 text-sm text-white">
            Your account will gain {preview.deltas.entries.localOnlyLive.length} entries and{' '}
            {preview.deltas.weights.localOnlyLive.length} weights. Nothing is deleted anywhere.
          </p>
          {preview.conflicts.length > 0 ? (
            <p className="mt-1 text-sm text-white">
              {preview.conflicts.length} {preview.conflicts.length === 1 ? 'entry was' : 'entries were'} changed in both
              places.{' '}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setReviewOpen((v) => !v);
                }}
                className="underline underline-offset-2"
              >
                {reviewOpen ? 'Hide' : 'Review'}
              </button>
            </p>
          ) : null}
        </ChoiceCard>

        {reviewOpen ? (
          <div className="ms-2 flex flex-col gap-2 rounded-md border border-[color:var(--border)] bg-surface-2 p-3 text-xs text-gray">
            {preview.conflicts.map((c) => (
              <div key={`${c.table}-${c.id}`} className="border-b border-[color:var(--border)] pb-2 last:border-0 last:pb-0">
                <p className="font-semibold text-white">{c.label}</p>
                <p className={c.localWins ? 'text-white' : ''}>This device — {c.local.summary} {c.localWins ? '(kept)' : ''}</p>
                <p className={!c.localWins ? 'text-white' : ''}>Your account — {c.remote.summary} {!c.localWins ? '(kept)' : ''}</p>
              </div>
            ))}
            <p className="text-gray-soft">
              {BRAND.name} keeps the newer change. After merging you can edit any of these on the Log screen.
            </p>
          </div>
        ) : null}

        <ChoiceCard
          name={legendId}
          value="keep-device"
          selected={option === 'keep-device'}
          onSelect={() => setOption('keep-device')}
          title="Keep this device only"
        >
          <p className="text-sm text-gray">Replaces your account&rsquo;s data with this device&rsquo;s.</p>
          {preview.deltas.entries.remoteOnlyLive.length + preview.deltas.weights.remoteOnlyLive.length > 0 ? (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-fm-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {preview.deltas.entries.remoteOnlyLive.length} entries and {preview.deltas.weights.remoteOnlyLive.length}{' '}
              weights in your account will be deleted.
            </p>
          ) : null}
        </ChoiceCard>

        <ChoiceCard
          name={legendId}
          value="keep-account"
          selected={option === 'keep-account'}
          onSelect={() => setOption('keep-account')}
          title="Keep account only"
        >
          <p className="text-sm text-gray">Replaces this device&rsquo;s data with your account&rsquo;s.</p>
          {preview.deltas.entries.localOnlyLive.length + preview.deltas.weights.localOnlyLive.length > 0 ? (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-fm-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {preview.deltas.entries.localOnlyLive.length} entries and {preview.deltas.weights.localOnlyLive.length}{' '}
              weights on this device will be deleted. Download the backup above first.
            </p>
          ) : null}
        </ChoiceCard>
      </fieldset>

      {option !== 'merge-both' && !backupDownloaded ? (
        <label className="flex cursor-pointer items-start gap-2 text-sm text-gray">
          <input
            type="checkbox"
            checked={skipBackup}
            onChange={(event) => setSkipBackup(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--gold)]"
          />
          I don&rsquo;t need a backup
        </label>
      ) : null}

      {committing ? (
        <p role="status" aria-live="polite" className="text-sm text-gray">
          {committingLabel}
        </p>
      ) : null}

      <Button
        className="w-full"
        disabled={committing || (option !== 'merge-both' && !backupDownloaded && !skipBackup)}
        onClick={() => {
          if (option === 'merge-both') void commit(remote, preview);
          else setConfirmOpen(true);
        }}
        aria-busy={committing}
      >
        {primaryLabel}
      </Button>
      <button
        type="button"
        onClick={decideLater}
        disabled={committing}
        className="inline-flex min-h-[44px] items-center justify-center text-sm font-semibold text-gray underline-offset-4 hover:text-white hover:underline"
      >
        Decide later — keep working offline
      </button>

      {confirmOpen ? (
        <ConfirmDestructive
          option={option}
          preview={preview}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            void commit(remote, preview);
          }}
        />
      ) : null}
    </div>
  );
}

function ChoiceCard({
  name,
  value,
  selected,
  onSelect,
  title,
  badge,
  children,
}: {
  name: string;
  value: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-md p-4 transition-colors ${
        selected ? 'border-2 border-[color:var(--gold)] bg-fm-accent-quiet' : 'border border-[color:var(--border)] bg-surface-1'
      }`}
    >
      <input type="radio" name={name} value={value} checked={selected} onChange={onSelect} className="sr-only" />
      <span className="flex items-center gap-2 text-sm font-bold text-white">
        {selected ? <Check size={16} className="text-gold" aria-hidden="true" /> : null}
        {title}
        {badge ? <span className="rounded-xs bg-gold-mark px-1.5 py-0.5 text-[10px] font-bold text-black">{badge}</span> : null}
      </span>
      {children}
    </label>
  );
}

function ConfirmDestructive({
  option,
  preview,
  onCancel,
  onConfirm,
}: {
  option: Option;
  preview: MergePreview;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const entries = option === 'keep-device' ? preview.deltas.entries.remoteOnlyLive.length : preview.deltas.entries.localOnlyLive.length;
  const weights = option === 'keep-device' ? preview.deltas.weights.remoteOnlyLive.length : preview.deltas.weights.localOnlyLive.length;
  const from = option === 'keep-device' ? 'your account' : 'this device';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--fm-scrim)] p-4">
      <div role="alertdialog" aria-modal="true" className="flex w-full max-w-[420px] flex-col gap-4 rounded-lg border border-fm-danger/40 bg-surface-2 p-5">
        <p className="text-sm font-semibold text-white">
          Delete {entries} entries and {weights} weights from {from}? This can&rsquo;t be undone.
        </p>
        <div className="flex gap-2">
          <Button variant="danger" className="flex-1" onClick={onConfirm}>
            Delete and continue
          </Button>
          <Button variant="ghost" className="flex-1" onClick={onCancel}>
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}
