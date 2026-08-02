import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

interface DoneSummary {
  added: { entries: number; weights: number; customFoods: number; favourites: number };
  keptNewer: number;
  deleted: { entries: number; weights: number };
}

function isDoneSummary(value: unknown): value is DoneSummary {
  return typeof value === 'object' && value !== null && 'added' in value && 'deleted' in value;
}

function summaryLine(summary: DoneSummary): string {
  const parts: string[] = [];
  const { added } = summary;
  if (added.entries > 0) parts.push(`Added ${added.entries} entr${added.entries === 1 ? 'y' : 'ies'}`);
  if (added.weights > 0) parts.push(`${added.weights} weight${added.weights === 1 ? '' : 's'}`);
  if (added.customFoods > 0) parts.push(`${added.customFoods} custom food${added.customFoods === 1 ? '' : 's'}`);
  if (added.favourites > 0) parts.push(`${added.favourites} favourite${added.favourites === 1 ? '' : 's'}`);
  if (summary.keptNewer > 0) parts.push(`kept ${summary.keptNewer} newer version${summary.keptNewer === 1 ? '' : 's'}`);
  if (summary.deleted.entries > 0 || summary.deleted.weights > 0) {
    parts.push(`deleted ${summary.deleted.entries} entries and ${summary.deleted.weights} weights`);
  } else if (parts.length > 0) {
    parts.push('deleted nothing');
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nothing needed to change.';
}

/**
 * `/sync/merge/done` (docs/DESIGN.md §7.11 rule 8). Reached only via
 * `navigate(..., { replace: true, state })` from `MergeScreen`, mirroring
 * `RecoveryCodeScreen`'s pattern: captured once on mount, never re-derivable from a
 * refresh — a stale summary would be actively misleading here, so a direct reload shows
 * an honest "nothing to show" fallback instead of guessing.
 */
export function MergeDoneScreen(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [summary] = useState<DoneSummary | null>(() => (isDoneSummary(location.state) ? location.state : null));

  useEffect(() => {
    if (!summary) return;
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[560px] flex-col justify-center gap-5 p-6">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={22} className="text-fm-ok" aria-hidden="true" />
          <h1 className="text-lg font-extrabold text-white">
            {summary ? 'Your data is combined' : 'Merge complete'}
          </h1>
        </div>
        <p role="status" className="text-sm leading-relaxed text-white">
          {summary ? summaryLine(summary) : 'Your device and account data have been reconciled.'}
        </p>
        <p className="text-xs leading-relaxed text-gray-soft">
          There&rsquo;s no undo. Your backup file, if you downloaded one, still has the previous state.
        </p>
        <Button onClick={() => navigate('/', { replace: true })}>Go to Today</Button>
      </Card>
    </div>
  );
}
