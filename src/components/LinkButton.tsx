import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface LinkButtonProps {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
}

/**
 * A navigation control that looks like a button but is a real anchor — so it keeps
 * middle-click, "open in new tab", and the correct link semantics for screen readers.
 * Use this for navigation; use <Button> for actions.
 */
export function LinkButton({
  to,
  children,
  variant = 'primary',
  className,
}: LinkButtonProps): JSX.Element {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md px-5 text-[15px]',
        'transition-[background-color,filter] duration-200 ease-out',
        variant === 'primary'
          ? 'bg-gold-mark font-bold text-black hover:brightness-110'
          : variant === 'danger'
            ? 'border border-[color:var(--danger)] bg-transparent font-semibold text-danger hover:bg-danger/10'
            : 'border border-[color:var(--border-strong)] bg-surface-2 font-semibold text-white hover:bg-surface-3',
        className,
      )}
    >
      {children}
    </Link>
  );
}
