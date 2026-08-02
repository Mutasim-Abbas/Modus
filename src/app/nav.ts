import {
  Camera,
  ClipboardList,
  History,
  Home,
  LayoutGrid,
  TrendingUp,
  User,
  UtensilsCrossed,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only the root route needs an exact match; every other route matches its subtree. */
  end: boolean;
}

/**
 * The five primary destinations (docs/DESIGN.md §5) — used by the phone bottom tab bar
 * and the tablet icon rail. Progress is primary; Plan/History/Profile live under More.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { to: '/', label: 'Today', icon: Home, end: true },
  { to: '/log', label: 'Log', icon: UtensilsCrossed, end: false },
  { to: '/scan', label: 'Scan', icon: Camera, end: false },
  { to: '/progress', label: 'Progress', icon: TrendingUp, end: false },
  { to: '/more', label: 'More', icon: LayoutGrid, end: false },
];

/**
 * The desktop sidebar (≥1024, docs/DESIGN.md §6.3) has room to show every destination —
 * there is no More at this width.
 */
export const DESKTOP_NAV: readonly NavItem[] = [
  { to: '/', label: 'Today', icon: Home, end: true },
  { to: '/log', label: 'Log', icon: UtensilsCrossed, end: false },
  { to: '/scan', label: 'Scan', icon: Camera, end: false },
  { to: '/progress', label: 'Progress', icon: TrendingUp, end: false },
  { to: '/plan', label: 'Plan', icon: ClipboardList, end: false },
  { to: '/history', label: 'History', icon: History, end: false },
];

export const DESKTOP_NAV_SECONDARY: readonly NavItem[] = [
  { to: '/profile', label: 'Profile', icon: User, end: false },
];
