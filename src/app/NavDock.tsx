import { NavLink } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { LOG_ACTION, PRIMARY_NAV } from '@/app/nav';
import { useShellBreakpoint } from '@/app/useBreakpoint';
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
          <NavLink
            to={LOG_ACTION.to}
            aria-label={LOG_ACTION.label}
            className={cn(
              'bg-accent-mark text-white shadow-accent transition-transform duration-2 ease-out',
              'hover:-translate-y-0.5 active:translate-y-0',
              isPhone
                ? 'grid h-[62px] w-[62px] -translate-y-6 place-items-center rounded-[24px] ring-[6px] ring-fm-bg/90 hover:-translate-y-7'
                : 'flex min-h-[48px] items-center gap-2.5 rounded-[19px] px-5 text-[13px] font-bold',
            )}
          >
            <Plus size={isPhone ? 27 : 17} strokeWidth={isPhone ? 1.6 : 2.4} aria-hidden="true" />
            {isPhone ? null : LOG_ACTION.label}
          </NavLink>
        </div>
      </nav>
    </div>
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
