import { NavLink } from 'react-router-dom';
import { PRIMARY_NAV } from '@/app/nav';
import { cn } from '@/lib/cn';

/**
 * Tablet icon rail (768–1023px, docs/DESIGN.md §6.3). Same five primary destinations as
 * the phone tab bar, laid out as a fixed 80px column. Never icon-only — each item keeps
 * a label underneath.
 */
export function IconRail(): JSX.Element {
  return (
    <nav aria-label="Main" className="fm-glass flex flex-col items-stretch py-3">
      <ul className="flex flex-col gap-1 px-2">
        {PRIMARY_NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-md px-1',
                  'text-[10px] font-semibold transition-colors duration-200 ease-out',
                  isActive
                    ? 'bg-fm-accent-quiet text-gold-light'
                    : 'text-gray-soft hover:bg-surface-2 hover:text-gray',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute my-auto h-6 w-[3px] rounded-full bg-gold [inset-block:0] [inset-inline-start:0]"
                    />
                  ) : null}
                  <Icon size={22} aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.8} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
