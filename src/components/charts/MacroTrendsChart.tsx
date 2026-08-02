import { useEffect, useRef } from 'react';
import { Wheat } from 'lucide-react';
import type { DayKey } from '@/types';
import type { MacroDayPoint, MacroKey } from '@/features/progress/selectors';
import { macroAverage } from '@/features/progress/selectors';
import { EmptyState } from '@/components/EmptyState';
import { ChartFigure } from '@/components/charts/ChartFigure';
import { linearScale } from '@/components/charts/scale';
import { formatDayLabel } from '@/lib/date';

const BAR_WIDTH = 6;
const GAP = 2;
const HEIGHT = 64;

const MACRO_META: Record<MacroKey, { label: string; color: string }> = {
  protein: { label: 'Protein', color: 'var(--fm-data-protein)' },
  carbs: { label: 'Carbs', color: 'var(--fm-data-carbs)' },
  fat: { label: 'Fat', color: 'var(--fm-data-fat)' },
};

interface FacetProps {
  macro: MacroKey;
  points: MacroDayPoint[];
  targetGrams: number;
}

function MacroFacet({ macro, points, targetGrams }: FacetProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { label, color } = MACRO_META[macro];
  const logged = points.filter((p): p is { day: DayKey; grams: number } => p.grams !== null);
  const avg = macroAverage(points);
  const width = points.length * (BAR_WIDTH + GAP);
  const maxValue = Math.max(targetGrams, ...(logged.length ? logged.map((p) => p.grams) : [0]), 1) * 1.1;
  const y = linearScale([0, maxValue], [HEIGHT, 4]);
  const baseline = HEIGHT;

  // Same rationale as CaloriesChart: default to showing the most recent days rather
  // than an apparently-empty left edge when the range is wider than the card.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [points]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-bold" style={{ color }}>
          {label}
        </span>
        <span className="tabular-nums text-fm-text-subtle">{logged.length > 0 ? `${avg} g avg` : 'No data'}</span>
      </div>

      {logged.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-fm-text-faint">Nothing logged in this range.</p>
      ) : (
        <div ref={scrollRef} className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="presentation">
            <line x1={0} x2={width} y1={y(targetGrams)} y2={y(targetGrams)} stroke="var(--fm-data-ref)" strokeWidth={1} strokeDasharray="4 2" />
            {points.map((point, index) => {
              const cx = index * (BAR_WIDTH + GAP);
              if (point.grams === null) {
                return <line key={point.day} x1={cx} x2={cx + BAR_WIDTH} y1={baseline} y2={baseline} stroke="var(--fm-data-grid)" strokeWidth={1} />;
              }
              const barY = y(point.grams);
              return <rect key={point.day} x={cx} y={barY} width={BAR_WIDTH} height={Math.max(0, baseline - barY)} rx={2} fill={color} />;
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

interface MacroTrendsChartProps {
  days: DayKey[];
  protein: MacroDayPoint[];
  carbs: MacroDayPoint[];
  fat: MacroDayPoint[];
  targets: { protein: number; carbs: number; fat: number };
}

/**
 * §4.2.3. Three separate mini column charts rather than one grouped chart — three
 * series x many days in one plot is unreadable on a phone, and faceting removes the
 * cross-series colour-discrimination burden. No legend needed: each facet is titled.
 */
export function MacroTrendsChart({ days, protein, carbs, fat, targets }: MacroTrendsChartProps): JSX.Element {
  const anyLogged = [...protein, ...carbs, ...fat].some((p) => p.grams !== null);

  if (!anyLogged) {
    return (
      <EmptyState
        icon={Wheat}
        title="No macros logged in this range"
        description="Log a few days of food and your protein, carbs and fat trends appear here."
      />
    );
  }

  const first = days[0] as DayKey;
  const last = days[days.length - 1] as DayKey;
  const caption = `Macro trends, ${formatDayLabel(first)} to ${formatDayLabel(last)}: protein ${macroAverage(protein)} g avg, carbs ${macroAverage(carbs)} g avg, fat ${macroAverage(fat)} g avg.`;

  return (
    <ChartFigure
      caption={caption}
      table={{
        caption: 'Protein, carbs and fat per day.',
        columns: ['Day', 'Protein', 'Carbs', 'Fat'],
        rows: days.map((day, index) => [
          formatDayLabel(day),
          protein[index]?.grams !== null && protein[index]?.grams !== undefined ? `${protein[index]?.grams} g` : '—',
          carbs[index]?.grams !== null && carbs[index]?.grams !== undefined ? `${carbs[index]?.grams} g` : '—',
          fat[index]?.grams !== null && fat[index]?.grams !== undefined ? `${fat[index]?.grams} g` : '—',
        ]),
      }}
      visual={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MacroFacet macro="protein" points={protein} targetGrams={targets.protein} />
          <MacroFacet macro="carbs" points={carbs} targetGrams={targets.carbs} />
          <MacroFacet macro="fat" points={fat} targetGrams={targets.fat} />
        </div>
      }
    />
  );
}
