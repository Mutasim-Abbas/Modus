import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

/* Gold on dark fails AA for small text, so the primary button inverts:
   dark ink on a gold fill, which passes comfortably. */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gold-mark text-black font-bold hover:brightness-110 active:brightness-95',
  secondary:
    'bg-surface-2 text-white border border-[color:var(--border-strong)] hover:bg-surface-3',
  ghost: 'bg-transparent text-gray hover:text-white hover:bg-surface-2',
  danger: 'bg-transparent text-danger border border-[color:var(--danger)] hover:bg-danger/10',
};

const SIZES: Record<Size, string> = {
  // 44px minimum touch target — never shrink these below it.
  md: 'min-h-[48px] px-5 text-[15px]',
  sm: 'min-h-[44px] px-4 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md transition-[background-color,filter,opacity] duration-200 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
