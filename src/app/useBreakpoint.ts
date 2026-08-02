import { useSyncExternalStore } from 'react';

export type ShellBreakpoint = 'phone' | 'tablet' | 'desktop';

const TABLET_QUERY = '(min-width: 768px)';
const DESKTOP_QUERY = '(min-width: 1024px)';

function readBreakpoint(): ShellBreakpoint {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'phone';
  if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop';
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet';
  return 'phone';
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  const lists = [window.matchMedia(TABLET_QUERY), window.matchMedia(DESKTOP_QUERY)];
  for (const list of lists) {
    // Safari < 14 only has the deprecated addListener/removeListener pair.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
    } else {
      list.addListener(onChange);
    }
  }

  return () => {
    for (const list of lists) {
      if (typeof list.removeEventListener === 'function') {
        list.removeEventListener('change', onChange);
      } else {
        list.removeListener(onChange);
      }
    }
  };
}

/**
 * The shell's three layout tiers (docs/DESIGN.md §6.1): phone (<768, bottom tab bar),
 * tablet (768–1023, 80px icon rail) and desktop (≥1024, 260px sidebar).
 *
 * Deliberately re-derived from `matchMedia` rather than mirrored in pure CSS: the shell
 * renders a genuinely different nav landmark per tier (not the same DOM hidden three
 * times), which keeps exactly one `role="navigation"` in the accessibility tree at once.
 */
export function useShellBreakpoint(): ShellBreakpoint {
  return useSyncExternalStore(subscribe, readBreakpoint, () => 'phone');
}
