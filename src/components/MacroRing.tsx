import { motion, useReducedMotion } from 'framer-motion';
import { progressRatio } from '@/lib/macros';
import { cn } from '@/lib/cn';

interface MacroRingProps {
  consumed: number;
  target: number;
  label: string;
  unit: string;
  /** CSS variable name for the stroke, e.g. 'var(--gold)'. */
  color: string;
  size?: number;
  strokeWidth?: number;
}

/**
 * A single progress ring.
 *
 * The SVG is aria-hidden and the numbers are exposed as real text, so a screen reader
 * reads "Calories, 1420 of 2100 kcal" rather than trying to describe a circle.
 */
export function MacroRing({
  consumed,
  target,
  label,
  unit,
  color,
  size = 132,
  strokeWidth = 10,
}: MacroRingProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const ratio = progressRatio(consumed, target);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const over = target > 0 && consumed > target;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} aria-hidden="true" className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={reduceMotion ? false : { strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - ratio) }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.8, ease: [0.22, 1, 0.36, 1] }
            }
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              'text-2xl font-extrabold leading-none tabular-nums',
              over ? 'text-danger' : 'text-white',
            )}
          >
            {Math.round(consumed)}
          </span>
          <span className="mt-1 text-[11px] text-gray tabular-nums">
            / {Math.round(target)} {unit}
          </span>
        </div>
      </div>

      <span className="text-xs font-semibold uppercase tracking-wider text-gray">{label}</span>
      <span className="sr-only">
        {label}: {Math.round(consumed)} of {Math.round(target)} {unit}
        {over ? ' — over target' : ''}
      </span>
    </div>
  );
}

interface MacroBarProps {
  consumed: number;
  target: number;
  label: string;
  color: string;
}

/** Compact bar for the three macros under the calorie ring. */
export function MacroBar({ consumed, target, label, color }: MacroBarProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const ratio = progressRatio(consumed, target);
  const over = target > 0 && consumed > target;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray">{label}</span>
        <span className={cn('text-xs tabular-nums', over ? 'text-danger' : 'text-white')}>
          {Math.round(consumed)}/{Math.round(target)} g
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label={`${label}: ${Math.round(consumed)} of ${Math.round(target)} grams`}
        aria-valuenow={Math.round(consumed)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={reduceMotion ? false : { width: 0 }}
          animate={{ width: `${ratio * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
