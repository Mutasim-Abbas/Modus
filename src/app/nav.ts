import { LayoutGrid, Sparkles, TrendingUp, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only the root route needs an exact match; every other route matches its subtree. */
  end: boolean;
}

/**
 * The four destinations, and the only nav the app has at any width.
 *
 * Nocturne replaces the old three-tier chrome (phone tab bar / tablet icon rail / desktop
 * sidebar) with a single floating dock, so this list is no longer split per breakpoint —
 * see `NavDock`. Logging food is deliberately *not* in it: it is the one action the app
 * exists for, so it gets the raised button in the middle of the dock instead of competing
 * with the destinations as a fifth peer.
 *
 * Route paths are unchanged from v4 — only the labels and the chrome moved. `/progress`
 * still serves Insights, `/plan` still serves Coach, `/profile` still serves You, so every
 * existing bookmark, deep link and redirect keeps resolving.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { to: '/', label: 'Today', icon: LayoutGrid, end: true },
  { to: '/progress', label: 'Insights', icon: TrendingUp, end: false },
  { to: '/plan', label: 'Coach', icon: Sparkles, end: false },
  { to: '/profile', label: 'You', icon: User, end: false },
];

/** Where the dock's raised centre button goes. */
export const LOG_ACTION = { to: '/log', label: 'Log food' } as const;
