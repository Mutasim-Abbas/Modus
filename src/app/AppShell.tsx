import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { BottomTabBar } from '@/app/BottomTabBar';
import { IconRail } from '@/app/IconRail';
import { Sidebar } from '@/app/Sidebar';
import { TopBar } from '@/app/TopBar';
import { useShellBreakpoint } from '@/app/useBreakpoint';
import { useAppState } from '@/lib/useStore';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/AuthContext';
import { syncEngine } from '@/lib/sync/engine';
import { SyncBanner } from '@/features/sync/SyncBanner';
import { ToastHost } from '@/components/Toast';

/**
 * The responsive shell every screen renders inside (docs/DESIGN.md §6). Phone gets the
 * 480px frame and a bottom tab bar; tablet gets an 80px icon rail and an 8-column
 * content grid; desktop gets a real 260px sidebar, a sticky top bar and a 12-column
 * grid capped at 1100–1320px — a genuine desktop layout, not a stretched phone frame.
 *
 * Exactly one nav landmark is mounted at a time (picked by `useShellBreakpoint`, not by
 * CSS visibility) so the accessibility tree never carries three "Main" navigations.
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
  // mounted. `/auth/*` and `/sync/merge` render outside `<AppShell>` on purpose
  // (docs/DESIGN.md §7.9/§7.11), so neither ever starts this engine themselves; the
  // one-shot post-sign-in adoption check (`src/lib/sync/signInFlow.ts`) is a separate,
  // plain function those screens call directly instead.
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
    <div className="fm-shell fm-grain relative">
      {breakpoint === 'desktop' ? <Sidebar /> : null}
      {breakpoint === 'tablet' ? <IconRail /> : null}

      <div className="relative flex min-h-[100dvh] min-w-0 flex-col">
        <div className="ambient-grid pointer-events-none fixed inset-0" aria-hidden="true" />

        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface-2 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>

        {breakpoint === 'desktop' ? <TopBar /> : null}

        <main
          id="main"
          className={cn(
            'relative z-10 flex-1',
            isPhone
              ? 'app-frame px-4 pb-24 pt-6'
              : 'fm-content-grid px-6 pb-16 pt-8 md:px-6 lg:px-8',
          )}
        >
          <motion.div
            key={location.pathname}
            className={isPhone ? undefined : 'col-span-4 md:col-span-8 lg:col-span-12'}
            initial={still ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={still ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <SyncBanner />
            <Outlet />
          </motion.div>
        </main>

        {isPhone ? <BottomTabBar /> : null}
      </div>
      <ToastHost />
    </div>
  );
}
