import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProgressScreen } from '@/features/progress/ProgressScreen';
import { calculateTargets } from '@/lib/macros';
import { store } from '@/lib/store';
import { addDays, toDayKey } from '@/lib/date';
import { AuthProvider } from '@/features/auth/AuthContext';

// ProgressScreen's header now renders a `SyncChip` (docs/DESIGN.md §7.10, Task 6),
// which reads `useAuth()` — needs a real AuthProvider ancestor.

const profile = {
  sex: 'male' as const,
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate' as const,
  goal: 'maintain' as const,
};

const targetKcal = calculateTargets(profile).kcal;

const entry = {
  name: 'Chicken breast, cooked',
  grams: 150,
  kcal: 248,
  protein: 46.5,
  carbs: 0,
  fat: 5.4,
  meal: 'lunch' as const,
  source: 'food-db' as const,
};

/**
 * jsdom reports every media query as non-matching, which `useShellBreakpoint` correctly
 * reads as "phone" — and the phone mock's Insights is only four cards. The stat tiles,
 * macro trends and weekly averages are desktop's, so any test asserting those has to say
 * so by stubbing the viewport first.
 */
function mockDesktopViewport(): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('1024px') || query.includes('768px'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

function renderProgress(): void {
  render(
    <MemoryRouter>
      <AuthProvider>
        <ProgressScreen />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  store.reset();
  store.setProfile(profile);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('empty state — the core honesty rule', () => {
  it('shows a real empty state per card, never a fake/demo curve, with no data at all', () => {
    mockDesktopViewport(); // desktop carries every card, so this covers all six at once
    renderProgress();

    expect(screen.getByText(/no weight readings yet/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing logged in this range/i)).toBeInTheDocument();
    expect(screen.getByText(/no macros logged in this range/i)).toBeInTheDocument();
    expect(screen.getByText(/no split to show yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no weeks logged yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no active streak/i)).toBeInTheDocument();
  });

  it('phone shows only the four cards the mock has, and their empty states', () => {
    renderProgress(); // jsdom default = phone

    expect(screen.getByText(/no weight readings yet/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing logged in this range/i)).toBeInTheDocument();
    expect(screen.getByText(/no split to show yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no active streak/i)).toBeInTheDocument();

    // Desktop's extras stay off the phone entirely — not merely hidden with CSS.
    expect(screen.queryByText(/no macros logged in this range/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no weeks logged yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /macro trends/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /weekly averages/i })).not.toBeInTheDocument();
  });

  it('does not render an SVG line/bar chart anywhere when there is no data', () => {
    renderProgress();
    // Every real chart drawing in this codebase is an `role="presentation"` SVG
    // (docs/DESIGN.md §4.2 chrome); empty-state icons are plain decorative lucide
    // glyphs without that role, so this distinguishes "a chart was drawn" from
    // "an empty-state icon rendered" without depending on path-string length.
    expect(document.querySelectorAll('svg[role="presentation"]')).toHaveLength(0);
  });
});

describe('a single weight reading', () => {
  it('does not crash and explicitly says there is no trend yet — never draws a line from one point', () => {
    store.logWeight(80.5, toDayKey());
    expect(() => renderProgress()).not.toThrow();
    expect(screen.getByText(/one reading — no trend yet/i)).toBeInTheDocument();
    // Appears both in the empty-state copy and the "Current weight" stat tile.
    expect(screen.getAllByText(/80\.5 kg/).length).toBeGreaterThan(0);
  });
});

describe('two weight readings', () => {
  it('draws the two points but suppresses the average/trend delta', () => {
    const today = toDayKey();
    store.logWeight(82, addDays(today, -10));
    store.logWeight(81, today);
    renderProgress();

    expect(screen.getByText(/two readings — not enough for a trend yet/i)).toBeInTheDocument();
  });
});

describe('current weight is range-independent', () => {
  it('still shows the true latest reading when it falls outside the selected 30-day range', async () => {
    const user = userEvent.setup();
    const today = toDayKey();
    store.logWeight(79.1, addDays(today, -45)); // inside the default 90-day window
    mockDesktopViewport(); // "Current weight" is a stat tile, so desktop-only
    renderProgress();

    // Switch to 30 days — the reading from 45 days ago drops out of the chart's window,
    // but "Current weight" must still report it, not go blank.
    await user.click(screen.getByRole('radio', { name: '30 days' }));

    expect(await screen.findByText(/no weight readings yet/i)).toBeInTheDocument(); // chart, scoped to 30d
    expect(screen.getByText('79.1 kg')).toBeInTheDocument(); // stat tile, not scoped
  });
});

describe('a real trend (>= 3 readings) and a real food log', () => {
  it('renders a weight delta headline and non-empty calorie/macro cards', () => {
    const today = toDayKey();
    store.logWeight(84.2, addDays(today, -60));
    store.logWeight(82.0, addDays(today, -30));
    store.logWeight(81.4, today);
    store.addEntry(entry, today);
    store.addEntry(entry, addDays(today, -1));

    renderProgress();

    // "-2.8 kg" style headline — sign/format details are covered at the unit level
    // (selectors.test.ts); here we only need the real number to appear on screen. It
    // legitimately appears twice (the chart headline and the "Change" stat tile).
    expect(screen.getAllByText(/2\.8 kg/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no weight readings yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing logged in this range/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no macros logged in this range/i)).not.toBeInTheDocument();
  });
});

describe('adding a weight reading from Progress', () => {
  it('logs today\'s weight through the inline form and reflects it immediately', async () => {
    const user = userEvent.setup();
    renderProgress();

    await user.click(screen.getByRole('button', { name: /add today.s weight/i }));
    const input = screen.getByLabelText(/today's weight/i);
    await user.type(input, '81.4');
    await user.click(screen.getByRole('button', { name: /save weight/i }));

    expect(await screen.findByText(/one reading — no trend yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/81\.4 kg/).length).toBeGreaterThan(0);
  });
});

describe('streaks', () => {
  it('reports a real current streak computed from consecutive on-target days', () => {
    const today = toDayKey();
    for (const offset of [0, -1, -2]) {
      store.addEntry({ ...entry, kcal: targetKcal, protein: 1, carbs: 1, fat: 1 }, addDays(today, offset));
    }
    renderProgress();

    expect(screen.getByLabelText('3 days streak')).toBeInTheDocument();
    expect(screen.getByText(/^active$/i)).toBeInTheDocument();
  });
});
