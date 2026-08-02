import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/app/App';
import { store } from '@/lib/store';

/**
 * `useShellBreakpoint` reads `matchMedia`, which jsdom always reports as non-matching
 * (see vitest.setup.ts) — that default correctly exercises the phone shell. To exercise
 * the desktop shell, stub every query at/above 1024px as matching.
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

const profile = {
  sex: 'male' as const,
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate' as const,
  goal: 'maintain' as const,
};

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  store.reset();
});

describe('routing — the onboarding gate', () => {
  it('sends a new user to onboarding instead of an empty dashboard', async () => {
    renderAt('/');
    expect(await screen.findByText(/let’s set your targets/i)).toBeInTheDocument();
  });

  it('guards every screen until a profile exists', async () => {
    for (const path of ['/log', '/scan', '/plan', '/history', '/profile']) {
      renderAt(path);
      expect(await screen.findByText(/let’s set your targets/i), path).toBeInTheDocument();
      document.body.innerHTML = '';
    }
  });

  it('does not show the main nav during onboarding', () => {
    renderAt('/');
    expect(screen.queryByRole('navigation', { name: /main/i })).not.toBeInTheDocument();
  });
});

describe('routing — once onboarded', () => {
  beforeEach(() => {
    store.setProfile(profile);
  });

  it('shows the dashboard at the root', async () => {
    renderAt('/');
    expect(await screen.findByText(/today’s meals/i)).toBeInTheDocument();
  });

  it('redirects away from onboarding once a profile exists', async () => {
    renderAt('/onboarding');
    expect(await screen.findByText(/today’s meals/i)).toBeInTheDocument();
  });

  it('redirects an unknown route to the dashboard', async () => {
    renderAt('/this-route-does-not-exist');
    expect(await screen.findByText(/today’s meals/i)).toBeInTheDocument();
  });

  it('renders the five primary destinations in the phone tab bar, Progress included', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /main/i });
    for (const label of ['Today', 'Log', 'Scan', 'Progress', 'More']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    // Plan/History/Profile are not primary destinations — they live under More.
    for (const label of ['Plan', 'History', 'Profile']) {
      expect(within(nav).queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('navigates to the log screen from the nav', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /main/i });

    await user.click(within(nav).getByRole('link', { name: 'Log' }));
    expect(await screen.findByLabelText(/search foods/i)).toBeInTheDocument();
  });

  it('navigates to Progress from the nav and shows honest, per-card empty states', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /main/i });

    await user.click(within(nav).getByRole('link', { name: 'Progress' }));
    // No fake/demo curve for a brand-new user — each card says exactly what's missing
    // (docs/DESIGN.md §7.5 "every card independently handles empty"). A generous
    // timeout here: this waits on the lazily-loaded Progress chunk resolving, which can
    // take a while under a loaded test-runner CPU, not on any real async data fetch.
    expect(await screen.findByText(/no weight readings yet/i, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/nothing logged in this range/i)).toBeInTheDocument();
    expect(screen.getByText(/no weeks logged yet/i)).toBeInTheDocument();
  });

  it('reaches Plan, History and Profile through the More hub', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /main/i });

    await user.click(within(nav).getByRole('link', { name: 'More' }));
    expect(await screen.findByRole('link', { name: /^Plan\b/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^History\b/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /profile & targets/i })).toBeInTheDocument();
  });

  it('lazily loads the plan screen without crashing', async () => {
    const user = userEvent.setup();
    renderAt('/more');

    await user.click(await screen.findByRole('link', { name: /^Plan\b/ }));
    expect(await screen.findByText(/a day built from the food database/i)).toBeInTheDocument();
  });

  it('offers a skip link to the main content', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute('href', '#main');
  });
});

describe('dashboard — empty vs populated', () => {
  beforeEach(() => {
    store.setProfile(profile);
  });

  it('shows an honest empty state with no data logged', async () => {
    renderAt('/');
    expect(await screen.findByText(/nothing logged yet/i)).toBeInTheDocument();
  });

  it('shows the full calorie target as remaining before anything is logged', async () => {
    renderAt('/');
    const targets = store.getState().targets;

    // The number and the unit are separate elements, so match on the heading's text.
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(`${targets?.kcal ?? 0} kcal left`);
  });

  it('reflects a logged entry in the totals and meal list', async () => {
    store.addEntry({
      name: 'Chicken breast, cooked',
      grams: 150,
      kcal: 248,
      protein: 46.5,
      carbs: 0,
      fat: 5.4,
      meal: 'lunch',
      source: 'food-db',
    });

    renderAt('/');

    const targets = store.getState().targets;
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(`${(targets?.kcal ?? 0) - 248} kcal left`);

    // "248 of N kcal logged" appears as the subtitle and in the ring's screen-reader text.
    expect(screen.getAllByText(/248 of/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/chicken breast/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing logged yet/i)).not.toBeInTheDocument();
  });
});

describe('routing — desktop shell (≥1024px)', () => {
  beforeEach(() => {
    store.setProfile(profile);
    mockDesktopViewport();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows every destination directly in the sidebar — no More at this width', async () => {
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: /main/i });
    for (const label of ['Today', 'Log', 'Scan', 'Progress', 'Plan', 'History', 'Profile']) {
      expect(within(nav).getByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole('link', { name: /^More$/ })).not.toBeInTheDocument();
  });

  it('redirects /more to /profile, since the sidebar already shows everything', async () => {
    renderAt('/more');
    expect(await screen.findByText(/your details and targets/i)).toBeInTheDocument();
  });
});
