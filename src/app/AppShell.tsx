import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { NavDock } from '@/app/NavDock';
import { useShellBreakpoint } from '@/app/useBreakpoint';
import { useAppState } from '@/lib/useStore';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/AuthContext';
import { syncEngine } from '@/lib/sync/engine';
import { SyncBanner } from '@/features/sync/SyncBanner';
import { ToastHost } from '@/components/Toast';

/**
 * The shell every screen renders inside.
 *
 * Nocturne is a single centred column at every width — one measure capped at 1180px, with
 * the nav floating over it as a dock rather than framing it. The previous three-tier
 * chrome (phone tab bar / tablet icon rail / desktop 260px sidebar + top bar) is gone,
 * which is why `Sidebar`, `IconRail`, `TopBar` and `BottomTabBar` are no longer mounted:
 * the mocks put the account chip and avatar in each screen's own header instead.
 *
 * Exactly one nav landmark is mounted, so the accessibility tree never carries more than
 * one "Main" navigation.
 */
export function AppShell(): JSX.Element {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { settings } = useAppState();
  const breakpoint = useShellBreakpoint();
  const auth = useAuth();

  // The in-app toggle layers on top of the OS-level preference.
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
  }, [settings.reducedMotion]);

  // The background sync engine (the project notes P4.2) runs only while an account is
  // signed in, and only for as long as this shell — the real, chrome-carrying app — is
  // mounted. `/auth/*` and `/sync/merge` render outside `<AppShell>` on purpose, so
  // neither ever starts this engine themselves; the one-shot post-sign-in adoption check
  // (`src/lib/sync/signInFlow.ts`) is a separate, plain function those screens call.
  useEffect(() => {
    if (auth.status === 'signed-in' && auth.user) {
      syncEngine.start(auth.user.id);
      void syncEngine.syncNow();
      return () => syncEngine.stop();
    }
    syncEngine.stop();
    return undefined;
  }, [auth.status, auth.user]);

  const still = reduceMotion || settings.reducedMotion;
  const isPhone = breakpoint === 'phone';

  return (
    <div className="fm-grain relative min-h-[100dvh] bg-fm-bg bg-app-glow">
      <div className="ambient-grid pointer-events-none fixed inset-0" aria-hidden="true" />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-fm-field focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <main
        id="main"
        className={cn(
          /* The bottom padding clears the floating dock — it overlaps content, so the
             last card needs room to scroll fully clear of it. */
          'relative z-10 mx-auto w-full max-w-[1180px]',
          isPhone ? 'px-5 pb-36 pt-14' : 'px-10 pb-40 pt-10',
        )}
      >
        <motion.div
          key={location.pathname}
          initial={still ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={still ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <SyncBanner />
          <Outlet />
        </motion.div>
      </main>

      <NavDock />
      <ToastHost />
    </div>
  );
}
