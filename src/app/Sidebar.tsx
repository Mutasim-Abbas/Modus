import { NavLink } from 'react-router-dom';
import { UserCircle2 } from 'lucide-react';
import { DESKTOP_NAV, DESKTOP_NAV_SECONDARY } from '@/app/nav';
import { useAuth } from '@/features/auth/AuthContext';
import { cn } from '@/lib/cn';

function GoldMark(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 place-items-center rounded-md bg-gold-mark text-sm font-black text-black"
    >
      FM
    </span>
  );
}

/**
 * Desktop sidebar (≥1024px, docs/DESIGN.md §6.3). Wide enough to show every destination,
 * so there is no `/more` here — Plan, History and Profile are direct items.
 */
export function Sidebar(): JSX.Element {
  const auth = useAuth();
  // Hidden entirely when this deployment has no database configured, exactly like
  // ai_unconfigured already hides the scan feature (docs/DESIGN.md §7.10).
  const secondaryItems =
    auth.status === 'unconfigured'
      ? DESKTOP_NAV_SECONDARY
      : [...DESKTOP_NAV_SECONDARY, { to: '/account', label: 'Account & sync', icon: UserCircle2, end: false }];

  return (
    <nav
      aria-label="Main"
      className="fm-glass flex h-full flex-col gap-1 px-3 py-4 [border-inline-end:1px_solid_var(--fm-border)]"
    >
      <div className="mb-4 flex h-[40px] items-center gap-2 px-1">
        <GoldMark />
        <span className="text-[15px] font-extrabold tracking-tight text-white">FitMacro</span>
      </div>

      <ul className="flex flex-col gap-1">
        {DESKTOP_NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-[44px] items-center gap-3 rounded-md px-3 text-[15px] font-semibold',
                  'transition-colors duration-200 ease-out',
                  isActive
                    ? 'bg-fm-accent-quiet text-gold-light'
                    : 'text-gray hover:bg-surface-2 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute my-auto h-5 w-[3px] rounded-full bg-gold [inset-block:0] [inset-inline-start:0]"
                    />
                  ) : null}
                  <Icon size={20} aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.8} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <hr className="my-3 border-[color:var(--fm-border)]" />

      <ul className="flex flex-col gap-1">
        {secondaryItems.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-[44px] items-center gap-3 rounded-md px-3 text-[15px] font-semibold',
                  'transition-colors duration-200 ease-out',
                  isActive
                    ? 'bg-fm-accent-quiet text-gold-light'
                    : 'text-gray hover:bg-surface-2 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute my-auto h-5 w-[3px] rounded-full bg-gold [inset-block:0] [inset-inline-start:0]"
                    />
                  ) : null}
                  <Icon size={20} aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.8} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Pinned to the bottom: language is read-only here until P3.5 lands. The real
          sync state (docs/DESIGN.md §7.10) is already shown once, in the desktop
          `TopBar` that sits directly above this sidebar — repeating it here would risk
          the two disagreeing if one re-rendered a beat before the other. */}
      <div className="mt-auto flex flex-col gap-2 px-1 pt-3 text-xs text-gray-soft">
        <span className="inline-flex w-fit items-center rounded-xs bg-surface-2 px-2 py-1 font-semibold tracking-wide text-gray">
          EN
        </span>
      </div>
    </nav>
  );
}
