import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { progressRatio } from '@/lib/macros';
import { cn } from '@/lib/cn';

interface MacroRingProps {
  consumed: number;
  target: number;
  label: string;
  unit: string;
  /**
   * CSS colour for the stroke, e.g. 'var(--fm-accent)'. Ignored when `gradient` is set —
   * the Nocturne calorie ring is a three-stop gradient, not a flat colour.
   */
  color: string;
  size?: number;
  strokeWidth?: number;
  /**
   * Paint the arc with the signature violet → cyan sweep instead of `color`. Reserved for
   * the one hero ring on Today; a chart series must stay a flat, nameable colour.
   */
  gradient?: boolean;
  /**
   * The headline shown inside the ring — "2711" over "kcal left". When omitted the ring
   * falls back to showing the raw fraction as its primary figure.
   */
  headline?: { value: number; unit: string; over: boolean };
  /**
   * Optional pill under the count — the pace read, e.g. "On track" or "312 over".
   * Purely a summary of numbers already on screen, so it is aria-hidden; the sr-only
   * sentence below already states consumed, target and whether you are over.
   */
  caption?: string;
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
  gradient = false,
  headline,
  caption,
}: MacroRingProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const gradientId = useId();
  const ratio = progressRatio(consumed, target);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const over = target > 0 && consumed > target;

  /**
   * The overshoot arc. `progressRatio` clamps at 1, so once you pass the target the
   * accent ring is full and stops moving — the ring alone can no longer tell you whether
   * you are 10 kcal over or 900. This second arc draws the excess in danger red, starting
   * from the top, so going over is *visible* rather than merely implied by the number
   * turning red.
   *
   * Capped at one full lap: past 200% of target the arc would lap the accent and start
   * reading as a smaller overshoot than it is.
   */
  const overRatio = over ? Math.min(1, (consumed - target) / target) : 0;
  /* A round linecap paints a full-width dot even on a zero-length dash, so an arc with
     nothing to show must be given no stroke at all — not merely a zero dasharray. */
  const overStrokeWidth = over ? strokeWidth : 0;

  /* The mock draws the hero ring at 244px with a 46px headline. Scaling off `size` keeps
     that relationship at the phone's 208px rather than hard-coding two sets of numbers. */
  const headlineSize = Math.round(size * 0.19);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} aria-hidden="true" className="-rotate-90">
          {gradient ? (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--fm-grad-ring-from)" />
                <stop offset="55%" stopColor="var(--fm-grad-ring-mid)" />
                <stop offset="100%" stopColor="var(--fm-grad-ring-to)" />
              </linearGradient>
            </defs>
          ) : null}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,.06)"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={gradient ? `url(#${gradientId})` : color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={reduceMotion ? false : { strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - ratio) }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.85, ease: [0.22, 1, 0.36, 1] }
            }
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--fm-danger)"
            strokeWidth={overStrokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${circumference * overRatio} ${circumference}`}
            initial={reduceMotion ? false : { strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${circumference * overRatio} ${circumference}` }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.85, ease: [0.22, 1, 0.36, 1] }
            }
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {headline ? (
            <>
              <span
                className={cn(
                  'font-num font-bold leading-none tracking-[-0.04em] tabular-nums',
                  headline.over ? 'text-danger' : 'text-white',
                )}
                style={{ fontSize: headlineSize }}
                aria-hidden="true"
              >
                {Math.round(headline.value)}
              </span>
              <span
                className="mt-2 text-[10.5px] font-semibold uppercase leading-none tracking-[0.18em] text-fm-text-faint"
                aria-hidden="true"
              >
                {headline.unit}
              </span>
              <span
                className="mt-1.5 font-num text-xs tabular-nums text-fm-text-faint"
                aria-hidden="true"
              >
                {Math.round(consumed)} / {Math.round(target)}
              </span>
            </>
          ) : (
            <>
              <span
                className={cn(
                  'font-num text-[15px] font-semibold tabular-nums',
                  over ? 'text-danger' : 'text-fm-text-subtle',
                )}
                aria-hidden="true"
              >
                {Math.round(consumed)} / {Math.round(target)}
              </span>
              <span
                className="mt-1 text-[9.5px] font-bold uppercase leading-none tracking-[0.16em] text-fm-text-faint"
                aria-hidden="true"
              >
                {unit} eaten
              </span>
            </>
          )}

          {caption ? (
            <span
              className="mt-3 rounded-full border border-fm-border-strong bg-fm-accent-quiet px-3 py-1.5 text-[10.5px] font-semibold leading-none text-fm-accent-hover"
              aria-hidden="true"
            >
              {caption}
            </span>
          ) : null}
        </div>
      </div>

      <span className="sr-only">
        {label}: {Math.round(consumed)} of {Math.round(target)} {unit}
        {over ? ' — over target' : ''}
        {caption ? `. ${caption}` : ''}
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

/**
 * The macro row under the calorie ring — label on the start edge, `eaten / target g` set
 * in the numeral face on the end edge, a 9px pill track beneath. Both mocks use this same
 * shape at phone and desktop width, so there is no second tile variant to keep in sync.
 */
export function MacroBar({ consumed, target, label, color }: MacroBarProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const ratio = progressRatio(consumed, target);
  const over = target > 0 && consumed > target;

  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-fm-text-muted">{label}</span>
        <span
          className={cn(
            'font-num text-xs tabular-nums',
            over ? 'text-danger' : 'text-fm-text-faint',
          )}
        >
          {Math.round(consumed)} / {Math.round(target)} g
        </span>
      </div>

      <div
        className="h-[9px] w-full overflow-hidden rounded-full bg-[rgba(255,255,255,.06)]"
        role="progressbar"
        aria-label={`${label}: ${Math.round(consumed)} of ${Math.round(target)} grams`}
        aria-valuenow={Math.round(consumed)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: over ? 'var(--fm-danger)' : color }}
          initial={reduceMotion ? false : { width: 0 }}
          animate={{ width: `${ratio * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

/**
 * Compact macro tile — three across. Kept for surfaces that show macros in a narrow
 * column (the plan meal cards, the scan review) where a full-width bar has no room.
 */
export function MacroStat({ consumed, target, label, color }: MacroBarProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const ratio = progressRatio(consumed, target);
  const over = target > 0 && consumed > target;

  return (
    <div className="rounded-lg border border-fm-border-neutral bg-fm-card px-4 pb-4 pt-4">
      <div className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-fm-text-faint">
        {label}
      </div>
      <div className="mb-2.5 mt-3 flex items-baseline gap-0.5">
        <span
          className={cn(
            'font-num text-[19px] font-bold tabular-nums',
            over ? 'text-danger' : 'text-white',
          )}
        >
          {Math.round(consumed)}
        </span>
        <span className="font-num text-[10.5px] tabular-nums text-fm-text-faint">
          /{Math.round(target)}g
        </span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,.06)]"
        role="progressbar"
        aria-label={`${label}: ${Math.round(consumed)} of ${Math.round(target)} grams`}
        aria-valuenow={Math.round(consumed)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: over ? 'var(--fm-danger)' : color }}
          initial={reduceMotion ? false : { width: 0 }}
          animate={{ width: `${ratio * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
