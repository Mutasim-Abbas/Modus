import { useEffect, useRef } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import type { CaloriesDayPoint } from '@/features/progress/selectors';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { ChartFigure } from '@/components/charts/ChartFigure';
import { linearScale } from '@/components/charts/scale';
import { formatDayLabel } from '@/lib/date';

const BAR_WIDTH = 16;
const GAP = 4;
const HEIGHT = 180;
const PAD = { top: 24, right: 8, bottom: 8, left: 44 };

interface CaloriesChartProps {
  series: CaloriesDayPoint[];
  targetKcal: number;
}

/**
 * §4.2.2. Days with no log at all render as an empty slot with a baseline tick, never
 * a zero bar — a zero bar would falsely claim "you ate nothing on this day".
 */
export function CaloriesChart({ series, targetKcal }: CaloriesChartProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const logged = series.filter(
    (p): p is { day: (typeof series)[number]['day']; kcal: number } => p.kcal !== null,
  );

  // A wide range (e.g. 90d/1y) is almost always wider than the card — scroll to the
  // most recent day by default, or a user with e.g. 10 real days inside a 90-day
  // window would see an apparently empty chart (all their bars off to the right).
  // LTR-only for now; this will need a `dir`-aware flip once RTL (P3.5) lands.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [series]);

  if (logged.length === 0) {
    return (
      <EmptyState
        icon={UtensilsCrossed}
        title="Nothing logged in this range"
        description="Log a few days and your daily calories chart appears here."
        action={<LinkButton to="/log">Log food</LinkButton>}
      />
    );
  }

  const maxValue = Math.max(targetKcal, ...logged.map((p) => p.kcal)) * 1.08;
  const width = PAD.left + PAD.right + series.length * (BAR_WIDTH + GAP);
  const y = linearScale([0, maxValue], [HEIGHT - PAD.bottom, PAD.top]);
  const baseline = HEIGHT - PAD.bottom;

  const highest = logged.reduce((a, b) => (b.kcal > a.kcal ? b : a));
  const mostRecent = logged[logged.length - 1] as { day: string; kcal: number };

  const first = series[0] as CaloriesDayPoint;
  const last = series[series.length - 1] as CaloriesDayPoint;
  const caption = `Calories per day, ${formatDayLabel(first.day)} to ${formatDayLabel(last.day)}: ${logged.length} of ${series.length} days logged. Highest was ${highest.kcal} kcal on ${formatDayLabel(highest.day)}.`;

  return (
    <ChartFigure
      caption={caption}
      table={{
        caption: `Calories per day against a target of ${targetKcal} kcal.`,
        columns: ['Day', 'Calories', 'vs target'],
        rows: series.map((p) => [
          formatDayLabel(p.day),
          p.kcal !== null ? `${p.kcal} kcal` : 'No log',
          p.kcal !== null ? `${p.kcal - targetKcal >= 0 ? '+' : ''}${p.kcal - targetKcal} kcal` : '—',
        ]),
      }}
      visual={
        <div ref={scrollRef} className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="presentation">
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(targetKcal)}
              y2={y(targetKcal)}
              stroke="var(--fm-data-ref)"
              strokeWidth={1.5}
              strokeDasharray="4 2"
            />
            <text x={width - PAD.right} y={y(targetKcal) - 6} textAnchor="end" fontSize={10} fill="var(--fm-ink-3)">
              Target {targetKcal} kcal
            </text>

            {series.map((point, index) => {
              const cx = PAD.left + index * (BAR_WIDTH + GAP);
              if (point.kcal === null) {
                return (
                  <line
                    key={point.day}
                    x1={cx}
                    x2={cx + BAR_WIDTH}
                    y1={baseline}
                    y2={baseline}
                    stroke="var(--fm-data-grid)"
                    strokeWidth={1}
                  />
                );
              }

              const barY = y(point.kcal);
              const over = point.kcal > targetKcal;
              const isHighest = point.day === highest.day;
              const isMostRecent = point.day === mostRecent.day;

              return (
                <g key={point.day}>
                  <rect x={cx} y={barY} width={BAR_WIDTH} height={Math.max(0, baseline - barY)} rx={4} fill="var(--fm-data-energy)" />
                  {over ? <rect x={cx} y={Math.max(PAD.top, barY - 3)} width={BAR_WIDTH} height={3} rx={1.5} fill="var(--fm-danger)" /> : null}
                  {over ? (
                    <text x={cx + BAR_WIDTH / 2} y={Math.max(PAD.top, barY - 8)} textAnchor="middle" fontSize={10} fill="var(--fm-danger)">
                      ▲
                    </text>
                  ) : null}
                  {isHighest || isMostRecent ? (
                    <text x={cx + BAR_WIDTH / 2} y={Math.max(12, barY - (over ? 22 : 8))} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--fm-ink-2)">
                      {point.kcal}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      }
      legend={
        <p className="text-[11px] leading-relaxed text-fm-text-faint">
          Dashed line is your target. Gaps are days with no log — never shown as zero.
        </p>
      }
    />
  );
}
