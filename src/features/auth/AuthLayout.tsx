import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Card } from '@/components/Card';

function GoldMark(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="grid h-11 w-11 place-items-center rounded-md bg-gold-mark text-base font-black text-black"
    >
      FM
    </span>
  );
}

interface AuthLayoutProps {
  children: ReactNode;
  /**
   * Hidden on the recovery-code screen only — docs/DESIGN.md §7.9: "No 'Skip'." Every
   * other auth screen keeps this link visible, never buried in fine print.
   */
  showContinueAsGuest?: boolean;
}

/**
 * The centred single-column card every `/auth/*` screen renders inside (docs/DESIGN.md
 * §7.9): max-inline-size 420px, on the page background, no sidebar, no tab bar. Rendered
 * as a sibling of `<AppShell>` in the router, not nested inside it.
 */
export function AuthLayout({ children, showContinueAsGuest = true }: AuthLayoutProps): JSX.Element {
  return (
    <div className="fm-grain relative flex min-h-[100dvh] flex-col items-center bg-black bg-app-glow px-4 pb-10 pt-12 sm:justify-center sm:pt-4">
      <div className="ambient-grid pointer-events-none fixed inset-0" aria-hidden="true" />
      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-5">
        <GoldMark />
        <Card className="w-full">{children}</Card>
        {showContinueAsGuest ? (
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-semibold text-gray underline-offset-4 transition-colors duration-200 ease-out hover:text-white hover:underline"
          >
            Continue without an account
          </Link>
        ) : null}
      </div>
    </div>
  );
}
