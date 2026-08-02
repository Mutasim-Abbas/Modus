import type { ReactNode } from 'react';

interface ScreenHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** An optional trailing slot next to the eyebrow — used by Today/Log/Progress for
   *  the phone/tablet `SyncChip` (docs/DESIGN.md §7.10). */
  action?: ReactNode;
}

export function ScreenHeader({ eyebrow, title, subtitle, action }: ScreenHeaderProps): JSX.Element {
  return (
    <header className="mb-5">
      <div className="flex items-center justify-between gap-3">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : <span />}
        {action}
      </div>
      <h1 className="text-2xl font-extrabold leading-tight text-white">{title}</h1>
      {subtitle ? <p className="mt-1.5 text-sm leading-relaxed text-gray">{subtitle}</p> : null}
    </header>
  );
}
