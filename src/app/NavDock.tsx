import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Camera, Plus, Search } from 'lucide-react';
import { LOG_ACTION, PRIMARY_NAV } from '@/app/nav';
import { useShellBreakpoint } from '@/app/useBreakpoint';
import { Sheet } from '@/components/Sheet';
import { cn } from '@/lib/cn';

/**
 * The floating navigation dock — the app's only nav landmark, at every width.
 *
 * Nocturne drops the previous three-tier chrome (phone tab bar / tablet icon rail /
 * desktop sidebar) for one glass pill that hovers over the content. Two arrangements of
 * the same four destinations:
 *
 *   • phone   — five slots, the raised "+" sitting in the middle where a thumb reaches it
 *   • ≥768    — a centred horizontal pill: icon + label per destination, a hairline
 *               divider, then the gradient "Log food" button on the end
 *
 * The arrangement is chosen from `useShellBreakpoint` rather than by hiding one copy with
 * CSS, so only one set of links is ever in the accessibility tree.
 */
export function NavDock(): JSX.Element {
  const breakpoint = useShellBreakpoint();
  const isPhone = breakpoint === 'phone';
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [chooserOpen, setChooserOpen] = useState(false);

  const go = (to: string): void => {
    setChooserOpen(false);
    navigate(to);
  };

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center',
        isPhone ? 'px-3.5 pb-6' : 'px-6 pb-7',
      )}
    >
      {/* The scrim behind the phone dock, so content scrolling under it fades out rather
          than colliding with the glass edge. */}
      {isPhone ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-fm-bg via-fm-bg/90 to-transparent"
        />
      ) : null}

      <nav
        aria-label="Main"
        className={cn(
          'fm-glass pointer-events-auto relative rounded-2xl border border-fm-border-neutral',
          isPhone ? 'grid w-full grid-cols-[1fr_1fr_78px_1fr_1fr] items-center p-2' : 'flex items-center gap-2 p-2.5',
        )}
      >
        {PRIMARY_NAV.map((item, index) => (
          <DockLink
            key={item.to}
            item={item}
            isPhone={isPhone}
            /* Phone reserves grid column 3 for the "+", so the last two destinations are
               pushed to columns 4 and 5. Desktop keeps plain source order. */
            placement={
              isPhone && index >= 2 ? (index === 2 ? 'col-start-4' : 'col-start-5') : undefined
            }
          />
        ))}

        {isPhone ? null : (
          <span
            aria-hidden="true"
            className="mx-1 h-[30px] w-px bg-fm-border-neutral"
          />
        )}

        <div
          className={cn(
            isPhone ? 'col-start-3 row-start-1 grid place-items-center' : 'contents',
          )}
        >
          {/* Phone asks first, desktop goes straight there. On phone the two ways to log
              are equally reachable from one thumb position; on desktop the header of
              `/log` already carries "Scan" a few pixels away, so a sheet in between would
              only add a step. Both routes stay addressable either way. */}
          {isPhone ? (
            <button
              type="button"
              onClick={() => setChooserOpen(true)}
              aria-label={LOG_ACTION.label}
              aria-haspopup="dialog"
              aria-expanded={chooserOpen}
              className={cn(
                'bg-accent-mark text-white shadow-accent transition-transform duration-2 ease-out',
                'hover:-translate-y-0.5 active:translate-y-0',
                'grid h-[62px] w-[62px] -translate-y-6 place-items-center rounded-[24px] ring-[6px] ring-fm-bg/90 hover:-translate-y-7',
              )}
            >
              <Plus size={27} strokeWidth={1.6} aria-hidden="true" />
            </button>
          ) : (
            <NavLink
              to={LOG_ACTION.to}
              aria-label={LOG_ACTION.label}
              className={cn(
                'bg-accent-mark text-white shadow-accent transition-transform duration-2 ease-out',
                'hover:-translate-y-0.5 active:translate-y-0',
                'flex min-h-[48px] items-center gap-2.5 rounded-[19px] px-5 text-[13px] font-bold',
              )}
            >
              <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
              {LOG_ACTION.label}
            </NavLink>
          )}
        </div>
      </nav>

      {/* Keyed on the route so that navigating out of the chooser tears the sheet down
          outright instead of animating it away.

          Both destinations are lazy routes, so choosing one suspends the whole shell —
          NavDock included — while the chunk loads. `AnimatePresence` has an exit in
          flight at that moment, and the "now remove it" callback is lost across the
          suspension: NavDock keeps its state, so nothing re-runs to clear the stale
          child, and the sheet's `fixed inset-0` scrim stays mounted at opacity 0,
          swallowing every click on the page you just navigated to. Remounting on
          `pathname` discards that stale AnimatePresence wholesale. Dismissing the sheet
          without navigating (Escape, backdrop, Cancel) keeps its exit animation. */}
      <Sheet
        key={pathname}
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        title="Add to your log"
      >
        <div className="flex flex-col gap-2.5">
          <ChooserOption
            icon={Search}
            title="Search the food list"
            description="Pick a portion, and it lands on today."
            onClick={() => go('/log')}
          />
          <ChooserOption
            icon={Camera}
            title="Scan a meal"
            description="Photo, then an estimate you edit before it saves."
            tone="cyan"
            onClick={() => go('/scan')}
          />
        </div>
      </Sheet>
    </div>
  );
}

function ChooserOption({
  icon: Icon,
  title,
  description,
  onClick,
  tone = 'accent',
}: {
  icon: typeof Search;
  title: string;
  description: string;
  onClick: () => void;
  tone?: 'accent' | 'cyan';
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3.5 rounded-lg border p-4 text-start transition-colors duration-2 ease-out',
        tone === 'cyan'
          ? 'border-[color:var(--fm-accent-2-quiet)] hover:bg-fm-accent-2-quiet'
          : 'border-fm-border-neutral hover:bg-fm-accent-quiet',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid h-12 w-12 shrink-0 place-items-center rounded-md',
          tone === 'cyan' ? 'bg-fm-accent-2-quiet text-fm-accent-2-ink' : 'bg-fm-accent-quiet text-fm-accent-hover',
        )}
      >
        <Icon size={20} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-fm-text">{title}</span>
        <span className="mt-1 block text-[11.5px] leading-relaxed text-fm-text-subtle">
          {description}
        </span>
      </span>
    </button>
  );
}

function DockLink({
  item,
  isPhone,
  placement,
}: {
  item: (typeof PRIMARY_NAV)[number];
  isPhone: boolean;
  /** Optional grid-column utility, used only by the phone arrangement. */
  placement?: string | undefined;
}): JSX.Element {
  const { to, label, icon: Icon, end } = item;

  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'transition-colors duration-2 ease-out',
          placement,
          isPhone
            ? 'flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-[19px]'
            : 'flex min-h-[48px] items-center gap-2.5 rounded-[19px] px-5 text-[13px] font-semibold',
          isActive
            ? 'bg-fm-accent-quiet text-fm-accent-hover'
            : 'text-fm-text-faint hover:bg-white/[0.04] hover:text-fm-text-muted',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={isPhone ? 17 : 15} strokeWidth={isActive ? 2.4 : 1.9} aria-hidden="true" />
          <span className={isPhone ? 'text-[10px] font-semibold tracking-[0.02em]' : undefined}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
