import { NavLink } from 'react-router-dom';
import { PRIMARY_NAV } from '@/app/nav';
import { cn } from '@/lib/cn';

/**
 * Phone tab bar (<768px, docs/DESIGN.md §6.2). Exactly the five primary destinations;
 * labels are always visible — an icon-only tab bar is a usability failure.
 */
export function BottomTabBar(): JSX.Element {
  return (
    <nav
      aria-label="Main"
      className="fm-glass safe-bottom sticky bottom-0 z-20 [border-block-start:1px_solid_var(--fm-border)]"
    >
      <ul className="mx-auto flex max-w-app items-stretch justify-between px-1 pt-1">
        {PRIMARY_NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-sm px-1 py-1.5',
                  'text-[10px] font-semibold transition-colors duration-200 ease-out',
                  isActive ? 'text-gold-light' : 'text-gray-soft hover:text-gray',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 mx-auto h-[3px] w-6 rounded-full bg-gold [inset-inline:0]"
                    />
                  ) : null}
                  <Icon size={19} aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.8} />
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
