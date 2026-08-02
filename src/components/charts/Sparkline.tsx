import { linearScale } from '@/components/charts/scale';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

/**
 * A tiny decorative trend line — e.g. the "Body weight" summary on Profile. Always
 * paired with real text (the latest value, a link to the full chart) elsewhere on the
 * card, so this alone is never the only way to read the data (docs/DESIGN.md §0.4).
 */
export function Sparkline({ values, width = 96, height = 28, color = 'var(--fm-data-energy)' }: SparklineProps): JSX.Element | null {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = linearScale([0, values.length - 1], [2, width - 2]);
  const y = linearScale([min, max], [height - 4, 4]);

  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" role="presentation">
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
