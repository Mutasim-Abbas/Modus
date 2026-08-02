import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...props }: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-lg border border-[color:var(--border)] bg-surface/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
