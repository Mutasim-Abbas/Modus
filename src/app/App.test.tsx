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

  it('renders the four destinations plus the raised log button in the dock', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /main/i });
    for (const label of ['Today', 'Insights', 'Coach', 'You']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    // Logging is the app's one action, so it gets the raised centre button rather than
    // competing with the destinations as a fifth peer.
    expect(within(nav).getByRole('link', { name: 'Log food' })).toBeInTheDocument();

    // Scan, History and the old More hub are not destinations: scan is an input method
    // inside Log/Coach, and History is reached from Coach's shortcuts. Both routes still
    // exist and still resolve — they are simply not in the dock.
    for (const label of ['More', 'History', 'Scan', 'Progress']) {
      expect(within(nav).queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('navigates to the log screen from the dock button', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /main/i });

    await user.click(within(nav).getByRole('link', { name: 'Log food' }));
    expect(await screen.findByLabelText(/search foods/i)).toBeInTheDocument();
  });

  it('navigates to Insights from the dock and shows honest, per-card empty states', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /main/i });

    await user.click(within(nav).getByRole('link', { name: 'Insights' }));
    // No fake/demo curve for a brand-new user — each card says exactly what's missing
    // (docs/DESIGN.md §7.5 "every card independently handles empty"). A generous
    // timeout here: this waits on the lazily-loaded Progress chunk resolving, which can
    // take a while under a loaded test-runner CPU, not on any real async data fetch.
    expect(await screen.findByText(/no weight readings yet/i, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/nothing logged in this range/i)).toBeInTheDocument();
    expect(screen.getByText(/no weeks logged yet/i)).toBeInTheDocument();
  });

  it('reaches Coach from the dock, and History from Coach’s shortcuts', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /main/i });

    await user.click(within(nav).getByRole('link', { name: 'Coach' }));
    expect(await screen.findByText(/plan it or scan it/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /look back at earlier days/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /recompute my targets/i })).toBeInTheDocument();
  });

  it('lazily loads the plan screen without crashing', async () => {
    renderAt('/plan');
    expect(await screen.findByText(/a day built for you/i)).toBeInTheDocument();
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

    // v4: the fraction lives in the ring now, stated in its screen-reader sentence
    // ("Calories: 248 of N kcal") rather than in a separate subtitle under the headline.
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

  it('shows the same four destinations in the dock as on a phone', async () => {
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: /main/i });
    for (const label of ['Today', 'Insights', 'Coach', 'You', 'Log food']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    // Nocturne has one nav at every width — there is no sidebar to carry extra links.
    for (const label of ['More', 'History', 'Scan', 'Plan', 'Profile']) {
      expect(within(nav).queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('mounts exactly one nav landmark, whatever the width', async () => {
    renderAt('/');
    await screen.findByRole('navigation', { name: /main/i });
    expect(screen.getAllByRole('navigation', { name: /main/i })).toHaveLength(1);
  });

  it('redirects /more to /profile, since the sidebar already shows everything', async () => {
    renderAt('/more');
    expect(await screen.findByText(/your details and targets/i)).toBeInTheDocument();
  });
});
