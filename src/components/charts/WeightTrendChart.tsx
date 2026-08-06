import { Scale } from 'lucide-react';
import type { DayKey, Goal } from '@/types';
import type { WeightSeriesPoint } from '@/features/progress/selectors';
import { EmptyState } from '@/components/EmptyState';
import { ChartFigure } from '@/components/charts/ChartFigure';
import { buildDayIndex, linearScale } from '@/components/charts/scale';
import { formatDayLabel } from '@/lib/date';

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 16, right: 16, bottom: 24, left: 40 };

interface WeightTrendChartProps {
  /** The full resolved range, ascending — used for x-axis position, not just the readings. */
  days: DayKey[];
  /** Live readings inside the range, ascending, with moving average pre-computed. */
  readings: WeightSeriesPoint[];
  deltaKg: number | null;
  /** Used only to decide whether a falling/rising trend reads as "on track" — never to invent a value. */
  goal?: Goal | undefined;
}

function deltaTone(deltaKg: number, goal: Goal | undefined): 'ok' | 'neutral' {
  if (goal === 'cut') return deltaKg <= 0 ? 'ok' : 'neutral';
  if (goal === 'bulk') return deltaKg >= 0 ? 'ok' : 'neutral';
  return 'neutral';
}

/**
 * §4.2.1. Below 2 readings this renders the E-6 empty state, never a chart — a single
 * dot cannot show a trend and must not be drawn as if it could. At exactly 2 readings
 * it draws the two points and the line between them but suppresses the moving average
 * and the headline delta, with an explicit "not enough for a trend yet" caption.
 */
export function WeightTrendChart({ days, readings, deltaKg, goal }: WeightTrendChartProps): JSX.Element {
  if (readings.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="No weight readings yet"
        description="Add a reading below. Add a second one on a different day and the trend line appears."
      />
    );
  }

  if (readings.length === 1) {
    const only = readings[0] as WeightSeriesPoint;
    return (
      <EmptyState
        icon={Scale}
        title="One reading — no trend yet"
        description={`${only.weightKg} kg on ${formatDayLabel(only.day)}. Add another reading on a different day and the trend line appears.`}
      />
    );
  }

  const dayIndex = buildDayIndex(days);
  const weights = readings.map((r) => r.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  // Never forced to zero — a weight chart zeroed at 0 kg is unreadable (docs/DESIGN.md §4.2.1).
  const yDomain: [number, number] = [min - 1, max + 1];

  const x = linearScale([0, Math.max(1, days.length - 1)], [PAD.left, WIDTH - PAD.right]);
  const y = linearScale(yDomain, [HEIGHT - PAD.bottom, PAD.top]);

  const points = readings.map((r) => ({ ...r, x: x(dayIndex.get(r.day) ?? 0), y: y(r.weightKg) }));
  const hasAverage = readings.length >= 3;
  const avgPoints = points.filter((p) => p.movingAvgKg !== null);
  const lastAvg = avgPoints[avgPoints.length - 1];

  const path = (pts: { x: number; y: number }[]): string =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const first = readings[0] as WeightSeriesPoint;
  const last = readings[readings.length - 1] as WeightSeriesPoint;
  const caption = hasAverage
    ? `Body weight, ${formatDayLabel(first.day)} to ${formatDayLabel(last.day)}: ${first.weightKg} kg to ${last.weightKg} kg, ${readings.length} readings.`
    : `Body weight: two readings, ${first.weightKg} kg on ${formatDayLabel(first.day)} and ${last.weightKg} kg on ${formatDayLabel(last.day)}. Not enough for a trend yet.`;

  const gridValues = [yDomain[1], (yDomain[0] + yDomain[1]) / 2, yDomain[0]];
  const tone = deltaKg !== null ? deltaTone(deltaKg, goal) : 'neutral';

  return (
    <div className="flex flex-col gap-3">
      {deltaKg !== null ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold">
          <span className={tone === 'ok' ? 'text-fm-ok' : 'text-fm-text'}>
            {deltaKg === 0 ? '—' : deltaKg < 0 ? '▼' : '▲'} {Math.abs(deltaKg)} kg
          </span>
          <span className="font-normal text-fm-text-subtle">
            over {readings.length} readings ({formatDayLabel(first.day)} – {formatDayLabel(last.day)})
          </span>
        </p>
      ) : (
        <p className="text-sm font-semibold text-fm-text-subtle">Two readings — not enough for a trend yet.</p>
      )}

      <ChartFigure
        caption={caption}
        table={{
          caption: 'Body weight by day, with the 7-day moving average where there is enough data.',
          columns: ['Day', 'Weight', '7-day average'],
          rows: readings.map((r) => [
            formatDayLabel(r.day),
            `${r.weightKg} kg`,
            r.movingAvgKg !== null ? `${r.movingAvgKg} kg` : '—',
          ]),
        }}
        visual={
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" style={{ height: HEIGHT }} role="presentation">
            {gridValues.map((value) => (
              <line
                key={`grid-${value}`}
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--fm-data-grid)"
                strokeWidth={1}
              />
            ))}
            {gridValues.map((value) => (
              <text
                key={`label-${value}`}
                x={PAD.left - 8}
                y={y(value)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={500}
                fill="var(--fm-ink-4)"
              >
                {value.toFixed(1)}
              </text>
            ))}

            <path
              d={path(points)}
              fill="none"
              stroke="var(--fm-ink-4)"
              strokeWidth={hasAverage ? 1.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p) => (
              <circle
                key={p.day}
                cx={p.x}
                cy={p.y}
                r={4}
                fill="var(--fm-ink-4)"
                stroke="var(--fm-surface-1)"
                strokeWidth={2}
              />
            ))}

            {hasAverage ? (
              <>
                <path d={path(avgPoints)} fill="none" stroke="var(--fm-data-energy)" strokeWidth={2} strokeLinecap="round" />
                {lastAvg ? (
                  <>
                    <circle cx={lastAvg.x} cy={lastAvg.y} r={5} fill="var(--fm-data-energy)" stroke="var(--fm-surface-1)" strokeWidth={2} />
                    <text
                      x={lastAvg.x}
                      y={lastAvg.y - 12}
                      textAnchor="end"
                      fontSize={12}
                      fontWeight={700}
                      fill="var(--fm-data-energy)"
                    >
                      {lastAvg.movingAvgKg} kg
                    </text>
                  </>
                ) : null}
              </>
            ) : null}
          </svg>
        }
        legend={
          <p className="text-[11px] leading-relaxed text-fm-text-faint">
            kg — axis is zoomed to the visible range.
            {hasAverage ? ' Violet line is the 7-day average; grey dots are individual readings.' : ''}
          </p>
        }
      />
    </div>
  );
}
