import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface MoreRowProps {
  to: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
}

/**
 * A single grouped-list row (docs/DESIGN.md §8.3), min 56px, full-width tap target.
 * The chevron is purely decorative — the whole row is the link, and it mirrors for
 * free because `ChevronRight` sits at the inline-end and RTL flips the icon glyph via
 * `rtl:-scale-x-100` once P3.5 sets `dir="rtl"`.
 */
export function MoreRow({ to, icon: Icon, label, hint }: MoreRowProps): JSX.Element {
  return (
    <Link
      to={to}
      className="flex min-h-[56px] items-center gap-3 rounded-md px-3 transition-colors duration-200 ease-out hover:bg-surface-2 focus-visible:bg-surface-2"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-gold-light">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
        {hint ? <span className="block text-xs text-gray">{hint}</span> : null}
      </span>
      <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-gray-soft rtl:-scale-x-100" />
    </Link>
  );
}
