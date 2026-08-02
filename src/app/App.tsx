import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { LogScreen } from '@/features/log/LogScreen';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';
import { AuthProvider } from '@/features/auth/AuthContext';
import { SignUpScreen } from '@/features/auth/SignUpScreen';
import { SignInScreen } from '@/features/auth/SignInScreen';
import { RecoveryCodeScreen } from '@/features/auth/RecoveryCodeScreen';
import { RecoverScreen } from '@/features/auth/RecoverScreen';
import { AccountScreen } from '@/features/account/AccountScreen';
import { ChangePasswordScreen } from '@/features/account/ChangePasswordScreen';
import { DeleteAccountScreen } from '@/features/account/DeleteAccountScreen';
import { useAppState } from '@/lib/useStore';

// The adoption/merge screen is the highest-risk surface in v3 (docs/DESIGN.md §7.11)
// but is only ever reached right after a sign-in — lazy-loading it keeps its weight
// (the full merge-preview UI) off the initial bundle every guest and already-synced
// user downloads.
const MergeScreen = lazy(() =>
  import('@/features/sync/MergeScreen').then((m) => ({ default: m.MergeScreen })),
);
const MergeDoneScreen = lazy(() =>
  import('@/features/sync/MergeDoneScreen').then((m) => ({ default: m.MergeDoneScreen })),
);

// Scan pulls in file reading + the review flow, and Plan pulls the planner; neither is
// needed on first paint, so they load on demand.
const ScanScreen = lazy(() =>
  import('@/features/scan/ScanScreen').then((m) => ({ default: m.ScanScreen })),
);
const PlanScreen = lazy(() =>
  import('@/features/plan/PlanScreen').then((m) => ({ default: m.PlanScreen })),
);
const HistoryScreen = lazy(() =>
  import('@/features/history/HistoryScreen').then((m) => ({ default: m.HistoryScreen })),
);
const ProfileScreen = lazy(() =>
  import('@/features/profile/ProfileScreen').then((m) => ({ default: m.ProfileScreen })),
);
const WeightLogScreen = lazy(() =>
  import('@/features/profile/WeightLogScreen').then((m) => ({ default: m.WeightLogScreen })),
);
const ProgressScreen = lazy(() =>
  import('@/features/progress/ProgressScreen').then((m) => ({ default: m.ProgressScreen })),
);
const MoreScreen = lazy(() =>
  import('@/features/more/MoreScreen').then((m) => ({ default: m.MoreScreen })),
);

function ScreenFallback(): JSX.Element {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray" role="status">
      Loading…
    </div>
  );
}

/** Until a profile exists there are no targets, so every screen redirects to onboarding. */
function RequireProfile({ children }: { children: JSX.Element }): JSX.Element {
  const { profile } = useAppState();
  const location = useLocation();

  if (!profile) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }
  return children;
}

/** Once onboarded, the onboarding route is no longer the entry point. */
function OnboardingRoute(): JSX.Element {
  const { profile } = useAppState();
  if (profile) return <Navigate to="/" replace />;
  return <OnboardingScreen />;
}

export function AppRoutes(): JSX.Element {
  return (
    // AuthProvider lives here (rather than only around <App>) so every test that
    // renders <AppRoutes /> directly (the project notes's existing idiom, e.g.
    // src/app/App.test.tsx) gets a real auth context without needing its own wrapper.
    <AuthProvider>
      <Suspense fallback={<ScreenFallback />}>
        <Routes>
        <Route path="/onboarding" element={<OnboardingRoute />} />

        {/* docs/DESIGN.md §7.9: auth screens are a centred card on the bare page
            background — no sidebar, no tab bar — so they render outside <AppShell>. */}
        <Route path="/auth/sign-up" element={<SignUpScreen />} />
        <Route path="/auth/sign-in" element={<SignInScreen />} />
        <Route path="/auth/recovery-code" element={<RecoveryCodeScreen />} />
        <Route path="/auth/recover" element={<RecoverScreen />} />

        {/* docs/DESIGN.md §7.11: full-screen, no nav chrome, same reasoning as the
            auth screens above — rendered outside <AppShell>. */}
        <Route path="/sync/merge" element={<MergeScreen />} />
        <Route path="/sync/merge/done" element={<MergeDoneScreen />} />

        <Route element={<AppShell />}>
          <Route
            path="/"
            element={
              <RequireProfile>
                <DashboardScreen />
              </RequireProfile>
            }
          />
          <Route
            path="/log"
            element={
              <RequireProfile>
                <LogScreen />
              </RequireProfile>
            }
          />
          <Route
            path="/scan"
            element={
              <RequireProfile>
                <ScanScreen />
              </RequireProfile>
            }
          />
          <Route
            path="/progress"
            element={
              <RequireProfile>
                <ProgressScreen />
              </RequireProfile>
            }
          />
          <Route
            path="/plan"
            element={
              <RequireProfile>
                <PlanScreen />
              </RequireProfile>
            }
          />
          <Route
            path="/history"
            element={
              <RequireProfile>
                <HistoryScreen />
              </RequireProfile>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireProfile>
                <ProfileScreen />
              </RequireProfile>
            }
          />
          <Route
            path="/profile/weight"
            element={
              <RequireProfile>
                <WeightLogScreen />
              </RequireProfile>
            }
          />
          <Route
            path="/more"
            element={
              <RequireProfile>
                <MoreScreen />
              </RequireProfile>
            }
          />
          {/* Not gated by RequireProfile: signing in / managing an account must never
              require completing onboarding first (guest mode is never a wall either
              direction — docs/DESIGN.md §7.9). */}
          <Route path="/account" element={<AccountScreen />} />
          <Route path="/account/password" element={<ChangePasswordScreen />} />
          <Route path="/account/delete" element={<DeleteAccountScreen />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
