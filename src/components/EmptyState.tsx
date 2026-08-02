import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

/** A real empty state. Never a fake row of placeholder data to make the screen look full. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[color:var(--border)] px-6 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-md bg-surface-2 text-gold">
        <Icon size={22} aria-hidden="true" />
      </span>
      <h3 className="text-base font-bold text-white">{title}</h3>
      <p className="max-w-[38ch] text-sm leading-relaxed text-gray">{description}</p>
      {action}
    </div>
  );
}
