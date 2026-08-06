import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'cyan' | 'warn' | 'ok';

interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  /** Which colour the figure takes. Neutral is the default; the rest are for emphasis. */
  tone?: Tone;
}

const TONE: Record<Tone, string> = {
  neutral: 'text-white',
  accent: 'text-fm-accent',
  cyan: 'text-fm-accent-2',
  warn: 'text-fm-warn',
  ok: 'text-fm-ok',
};

/**
 * The small stat card the mocks use in rows of three (Today) and pairs (Insights):
 * a tracked-out label, one figure in the numeral face, and a quiet line of context.
 */
export function StatTile({ label, value, hint, tone = 'neutral' }: StatTileProps): JSX.Element {
  return (
    <div className="rounded-lg border border-fm-border-neutral bg-fm-card p-5">
      <div className="mb-3 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-fm-text-faint">
        {label}
      </div>
      <div
        className={cn(
          'font-num text-2xl font-bold tracking-[-0.03em] tabular-nums',
          TONE[tone],
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[11px] text-fm-text-faint">{hint}</div> : null}
    </div>
  );
}
