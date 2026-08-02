import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ScanScreen } from '@/features/scan/ScanScreen';
import { resetScanAvailability } from '@/features/scan/availability';
import { selectDay, store } from '@/lib/store';
import { toDayKey } from '@/lib/date';

const profile = {
  sex: 'male' as const,
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate' as const,
  goal: 'maintain' as const,
};

const ANALYSIS = {
  items: [
    { name: 'Grilled chicken', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5, confidence: 0.85 },
    { name: 'White rice', grams: 200, kcal: 260, protein: 5, carbs: 56, fat: 1, confidence: 0.35 },
  ],
  totals: { kcal: 508, protein: 51, carbs: 56, fat: 6 },
  note: 'Portion sizes estimated from the plate; the rice may be under-counted.',
};

function renderScan(): void {
  render(
    <MemoryRouter>
      <ScanScreen />
    </MemoryRouter>,
  );
}

function photo(): File {
  return new File(['fake-image-bytes'], 'meal.jpg', { type: 'image/jpeg' });
}

/** jsdom has no real FileReader output; give it a deterministic data URL. */
function stubFileReader(dataUrl = 'data:image/jpeg;base64,ZmFrZQ=='): void {
  class StubReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(): void {
      this.result = dataUrl;
      this.onload?.();
    }
  }
  vi.stubGlobal('FileReader', StubReader);
}

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  store.reset();
  store.setProfile(profile);
  resetScanAvailability();
  stubFileReader();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ScanScreen — honest framing', () => {
  it('presents scanning as an estimate you review, not as a measurement', () => {
    renderScan();
    expect(screen.getByText(/estimates the macros/i)).toBeInTheDocument();
    expect(screen.getByText(/review and edit every number before anything is logged/i)).toBeInTheDocument();
  });

  it('says what happens to the photo', () => {
    renderScan();
    expect(screen.getByText(/not stored by fitmacro/i)).toBeInTheDocument();
  });
});

describe('ScanScreen — 503 ai_unconfigured', () => {
  it('disables the feature with an honest message and never crashes', async () => {
    const user = userEvent.setup();
    mockFetch(503, { error: 'ai_unconfigured' });
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());

    expect(await screen.findByText(/scanning isn’t available here/i)).toBeInTheDocument();
    expect(screen.getByText(/isn’t configured on this deployment/i)).toBeInTheDocument();
  });

  it('logs nothing and fabricates no result', async () => {
    const user = userEvent.setup();
    mockFetch(503, { error: 'ai_unconfigured' });
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await screen.findByText(/scanning isn’t available here/i);

    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
    expect(screen.queryByText(/kcal/i)).not.toBeInTheDocument();
  });

  it('points the user at the food database instead', async () => {
    const user = userEvent.setup();
    mockFetch(503, { error: 'ai_unconfigured' });
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());

    const link = await screen.findByRole('link', { name: /log from the food database/i });
    expect(link).toHaveAttribute('href', '/log');
  });

  it('removes the uploader so the user cannot be invited to fail again', async () => {
    const user = userEvent.setup();
    mockFetch(503, { error: 'ai_unconfigured' });
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await screen.findByText(/scanning isn’t available here/i);

    expect(screen.queryByLabelText(/choose a meal photo/i)).not.toBeInTheDocument();
  });

  it('stays disabled when the screen is revisited in the same session', async () => {
    const user = userEvent.setup();
    mockFetch(503, { error: 'ai_unconfigured' });
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await screen.findByText(/scanning isn’t available here/i);

    cleanupAndRerender();
    expect(screen.getByText(/scanning isn’t available here/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/choose a meal photo/i)).not.toBeInTheDocument();
  });

  it('treats a missing endpoint (404) the same way', async () => {
    const user = userEvent.setup();
    mockFetch(404, {});
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    expect(await screen.findByText(/scanning isn’t available here/i)).toBeInTheDocument();
  });
});

function cleanupAndRerender(): void {
  document.body.innerHTML = '';
  renderScan();
}

describe('ScanScreen — transient failures', () => {
  it('offers a retry after a server error, without disabling the feature', async () => {
    const user = userEvent.setup();
    mockFetch(500, {});
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed on the server/i);
    expect(screen.getByRole('button', { name: /try another photo/i })).toBeInTheDocument();
    // Still offered — a 500 is not evidence the feature is unconfigured.
    expect(screen.getByLabelText(/choose a meal photo/i)).toBeInTheDocument();
  });

  it('reports a rate limit honestly', async () => {
    const user = userEvent.setup();
    mockFetch(429, {});
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many scans/i);
  });

  it('reports a network failure without logging anything', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t reach the server/i);
    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
  });

  it('says so when the model finds no food, rather than logging zeroes', async () => {
    const user = userEvent.setup();
    mockFetch(200, { items: [], totals: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, note: '' });
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
  });
});

describe('ScanScreen — review before logging', () => {
  it('shows every item as an editable estimate with its confidence', async () => {
    const user = userEvent.setup();
    mockFetch(200, ANALYSIS);
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());

    expect(await screen.findByText(/check before logging/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Grilled chicken')).toBeInTheDocument();
    expect(screen.getByText(/high confidence \(85%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/low confidence — check this \(35%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/model note:/i)).toBeInTheDocument();
  });

  it('logs nothing until the user confirms', async () => {
    const user = userEvent.setup();
    mockFetch(200, ANALYSIS);
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await screen.findByText(/check before logging/i);

    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
  });

  it('logs the reviewed items, marked as scan-sourced', async () => {
    const user = userEvent.setup();
    mockFetch(200, ANALYSIS);
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await user.click(await screen.findByRole('button', { name: /log 2 items/i }));

    const entries = selectDay(store.getState(), toDayKey()).entries;
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.source === 'scan')).toBe(true);
    expect(entries[0]?.name).toBe('Grilled chicken');
  });

  it('logs the user’s edits, not the model’s original numbers', async () => {
    const user = userEvent.setup();
    mockFetch(200, ANALYSIS);
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await screen.findByText(/check before logging/i);

    const kcalInput = screen.getByLabelText(/^calories$/i, { selector: '#item-0-kcal' });
    await user.clear(kcalInput);
    await user.type(kcalInput, '300');

    await user.click(screen.getByRole('button', { name: /log 2 items/i }));

    const entries = selectDay(store.getState(), toDayKey()).entries;
    expect(entries[0]?.kcal).toBe(300);
  });

  it('lets the user remove an item they disagree with', async () => {
    const user = userEvent.setup();
    mockFetch(200, ANALYSIS);
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await user.click(await screen.findByRole('button', { name: /remove white rice/i }));
    await user.click(screen.getByRole('button', { name: /log 1 item/i }));

    const entries = selectDay(store.getState(), toDayKey()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Grilled chicken');
  });

  it('discards the whole scan without logging', async () => {
    const user = userEvent.setup();
    mockFetch(200, ANALYSIS);
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await user.click(await screen.findByRole('button', { name: /discard/i }));

    expect(selectDay(store.getState(), toDayKey()).entries).toHaveLength(0);
    expect(screen.getByLabelText(/choose a meal photo/i)).toBeInTheDocument();
  });

  it('updates the running total as items are edited', async () => {
    const user = userEvent.setup();
    mockFetch(200, ANALYSIS);
    renderScan();

    await user.upload(screen.getByLabelText(/choose a meal photo/i), photo());
    await screen.findByText(/check before logging/i);
    expect(screen.getByText('508 kcal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove white rice/i }));
    expect(await screen.findByText('248 kcal')).toBeInTheDocument();
  });
});
