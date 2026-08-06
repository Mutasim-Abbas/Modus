import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'cyan';

interface LinkButtonProps {
  to: string;
  children: ReactNode;
  variant?: Variant;
  className?: string;
}

/**
 * The primary fill is the violet gradient, carrying white ink — the mocks' one loud
 * control. `cyan` is its counterpart on the scan card only: cyan is dark-on-light, so it
 * takes near-black ink rather than white, which would sit at 1.9:1.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-mark font-bold text-white shadow-accent hover:brightness-110',
  secondary:
    'border border-fm-border-neutral bg-fm-field font-semibold text-white hover:bg-fm-hover',
  danger:
    'border border-[color:var(--danger)] bg-transparent font-semibold text-danger hover:bg-danger/10',
  cyan: 'bg-cyan-mark font-bold text-[#04212b] shadow-cyan hover:brightness-110',
};

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
        'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md px-5 text-[14px]',
        'transition-[background-color,filter,transform] duration-200 ease-out active:translate-y-0',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}
