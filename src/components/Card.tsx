import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...props }: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        /* Nocturne's card: a 28px-radius panel separated from the page by a hairline
           rather than by a brightness step. `.card` carries the surface, border, radius
           and padding — see src/index.css. */
        'card',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
