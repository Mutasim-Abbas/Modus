import { Navigate } from 'react-router-dom';
import { CloudOff, ClipboardList, History as HistoryIcon, Info, Scale, User } from 'lucide-react';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { useShellBreakpoint } from '@/app/useBreakpoint';
import { useAuth } from '@/features/auth/AuthContext';
import { useAppState, useStore } from '@/lib/useStore';
import { MoreRow } from '@/features/more/MoreRow';
import { SyncChip } from '@/features/sync/SyncChip';
import { BRAND } from '@/lib/brand';

/**
 * The `/more` hub (docs/DESIGN.md §5) — a real screen, not a menu popover. Holds every
 * destination that doesn't fit the five primary tabs on phone/tablet. At desktop widths
 * the sidebar already shows everything, so this route redirects to Profile there.
 */
export function MoreScreen(): JSX.Element {
  const breakpoint = useShellBreakpoint();
  const { settings } = useAppState();
  const store = useStore();
  const auth = useAuth();
  // Hidden entirely when this deployment has no database configured — the same
  // ai_unconfigured pattern `src/features/scan/availability.ts` already uses for Scan.
  const syncConfigured = auth.status !== 'unconfigured';

  if (breakpoint === 'desktop') {
    return <Navigate to="/profile" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader eyebrow="More" title="Everything else" />

      <section aria-labelledby="more-track">
        <h2 id="more-track" className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.08em] text-gray">
          Track
        </h2>
        <Card className="flex flex-col gap-0.5 p-2">
          <MoreRow to="/plan" icon={ClipboardList} label="Plan" hint="A day built from the food database" />
          <MoreRow to="/history" icon={HistoryIcon} label="History" hint="Every day you've logged" />
        </Card>
      </section>

      <section aria-labelledby="more-you">
        <h2 id="more-you" className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.08em] text-gray">
          You
        </h2>
        <Card className="flex flex-col gap-0.5 p-2">
          <MoreRow to="/profile" icon={User} label="Profile & targets" hint="Your details and calculated targets" />
          <MoreRow to="/profile/weight" icon={Scale} label="Weight log" hint="Add and review your weigh-ins" />
        </Card>
      </section>

      <section aria-labelledby="more-account">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 id="more-account" className="text-xs font-bold uppercase tracking-[0.08em] text-gray">
            Account
          </h2>
          <SyncChip />
        </div>
        {syncConfigured ? (
          <Card className="flex flex-col gap-0.5 p-2">
            <MoreRow
              to="/account"
              icon={User}
              label={auth.status === 'signed-in' ? 'Account & sync' : 'Sign in / Create account'}
            />
          </Card>
        ) : (
          <EmptyState
            icon={CloudOff}
            title="Accounts aren't set up on this deployment"
            description={`This copy of ${BRAND.name} has no database connected, so there's nothing to sign in to. Everything still works and stays on this device.`}
          />
        )}
      </section>

      <section aria-labelledby="more-app">
        <h2 id="more-app" className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.08em] text-gray">
          App
        </h2>
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-semibold text-white">Language</span>
            <span className="inline-flex items-center rounded-xs bg-surface-2 px-2 py-1 text-xs font-semibold tracking-wide text-gray">
              English
            </span>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold text-white">Reduce motion</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-gray">
                Turns off screen transitions and ring animations.
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={(event) => store.setSettings({ reducedMotion: event.target.checked })}
              className="h-6 w-6 shrink-0 accent-[color:var(--gold)]"
            />
          </label>

          <div className="flex items-center justify-between gap-4 [border-block-start:1px_solid_var(--fm-border)] pt-4">
            <span>
              <span className="block text-sm font-semibold text-white">Your data</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-gray">
                Export or reset everything you've logged.
              </span>
            </span>
            <LinkButton to="/profile" variant="secondary" className="min-h-[40px] px-4 text-sm">
              Manage
            </LinkButton>
          </div>
        </Card>
      </section>

      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-gray-soft">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        {BRAND.name} v3 — a real macro engine and a curated food database, honest about what it
        doesn't know.
      </p>
    </div>
  );
}
