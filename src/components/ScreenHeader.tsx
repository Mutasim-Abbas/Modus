import type { ReactNode } from 'react';

interface ScreenHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** A trailing slot on the end edge — the `SyncChip`, a range switcher, a screen action. */
  action?: ReactNode;
  /**
   * Show the small pulsing dot before the eyebrow. Reserved for Today, where it reads as
   * "this is live"; on a static screen it would be decoration claiming to mean something.
   */
  live?: boolean;
}

/**
 * The page header both mocks open every screen with: a tracked-out eyebrow, an oversized
 * tight-set title, and an optional explanatory line capped at a readable measure.
 */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  action,
  live = false,
}: ScreenHeaderProps): JSX.Element {
  return (
    <header className="mb-8 flex items-start justify-between gap-7">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2.5 flex items-center gap-2.5">
            {live ? (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-fm-ok shadow-[0_0_10px_rgba(52,211,153,.9)]"
              />
            ) : null}
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fm-text-faint">
              {eyebrow}
            </span>
          </div>
        ) : null}

        <h1 className="text-[27px] font-extrabold leading-[1.04] tracking-[-0.03em] text-white lg:text-[40px] lg:tracking-[-0.035em]">
          {title}
        </h1>

        {subtitle ? (
          <p className="mt-2.5 max-w-[58ch] text-[13.5px] leading-relaxed text-fm-text-faint lg:text-[14.5px]">
            {subtitle}
          </p>
        ) : null}
      </div>

      {action ? <div className="flex flex-none items-center gap-2.5">{action}</div> : null}
    </header>
  );
}
