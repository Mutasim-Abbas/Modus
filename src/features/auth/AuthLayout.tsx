import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { BRAND } from '@/lib/brand';
import { FOODS } from '@/data/foods';

interface AuthLayoutProps {
  children: ReactNode;
  /**
   * Hidden on the recovery-code screen only — docs/DESIGN.md §7.9: "No 'Skip'." Every
   * other auth screen keeps this link visible, never buried in fine print.
   */
  showContinueAsGuest?: boolean;
}

/**
 * The gate every `/auth/*` screen renders inside.
 *
 * Two arrangements of one layout, switched in CSS because both halves are the same DOM:
 *   • < 1024 — the form alone, centred, with the mark and a compact title above it
 *   • ≥ 1024 — a split screen: a brand panel carrying the product's claim on the
 *              inline-start, the form on the inline-end
 *
 * The brand panel is `aria-hidden`: it is marketing copy that repeats nothing the form
 * needs, and reading it aloud before every sign-in would be noise. The three facts are
 * derived, not asserted — `FOODS.length` is the real database size, so the number cannot
 * drift away from the truth the way a hard-coded "184" would.
 */
export function AuthLayout({ children, showContinueAsGuest = true }: AuthLayoutProps): JSX.Element {
  return (
    <div className="fm-grain relative min-h-[100dvh] bg-[#0f1017] lg:grid lg:grid-cols-[1.1fr_0.9fr]">
      {/* ── Brand panel (≥1024 only) ─────────────────────────────────────────── */}
      <aside
        aria-hidden="true"
        className="relative hidden flex-col justify-between overflow-hidden p-14 lg:flex"
        style={{
          background:
            'radial-gradient(760px 520px at 24% 12%, rgba(124,58,237,.32), transparent 62%), radial-gradient(520px 420px at 88% 92%, rgba(34,211,238,.14), transparent 62%), #131421',
        }}
      >
        <div className="flex items-center gap-3.5">
          <BrandMark size={46} />
          <span className="text-[17px] font-bold tracking-[0.01em]">{BRAND.name}</span>
        </div>

        <div className="max-w-[26ch]">
          <h2 className="text-[48px] font-extrabold leading-[1.06] tracking-[-0.04em] [text-wrap:pretty]">
            {BRAND.promise}
          </h2>
          <p className="mt-6 text-[15px] leading-[1.7] text-fm-text-subtle [text-wrap:pretty]">
            {BRAND.promiseSub}
          </p>
        </div>

        <div className="flex gap-11">
          {[
            { value: String(FOODS.length), label: 'foods, values you can read' },
            { value: '0', label: 'guessed numbers' },
            { value: '3', label: 'taps to log a meal' },
          ].map((fact) => (
            <div key={fact.label}>
              <div className="font-num text-[26px] font-bold tracking-[-0.03em] text-fm-accent-hover">
                {fact.value}
              </div>
              <div className="mt-1.5 text-xs text-fm-text-faint">{fact.label}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Form panel ───────────────────────────────────────────────────────── */}
      <div
        className="relative flex items-center justify-center px-6 py-12 lg:px-[52px]"
        style={{
          background:
            'radial-gradient(520px 400px at 50% 4%, rgba(124,58,237,.28), transparent 64%), radial-gradient(420px 320px at 10% 98%, rgba(34,211,238,.1), transparent 62%), #0f1017',
        }}
      >
        <div className="w-full max-w-[376px] animate-rise">
          {/* The mark leads the phone layout, where there is no brand panel to carry it. */}
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <BrandMark size={58} className="mb-3.5" />
          </div>

          {children}

          {showContinueAsGuest ? (
            <>
              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-fm-border-neutral" />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fm-text-disabled">
                  or
                </span>
                <span className="h-px flex-1 bg-fm-border-neutral" />
              </div>

              <Link
                to="/"
                className="flex min-h-[52px] w-full items-center justify-center rounded-md border border-fm-border-neutral bg-white/[0.04] px-4 text-[13px] font-semibold text-fm-text-muted transition-colors duration-200 ease-out hover:bg-white/[0.07] hover:text-white"
              >
                Continue without an account
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
