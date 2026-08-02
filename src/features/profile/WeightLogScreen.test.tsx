import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WeightLogScreen } from '@/features/profile/WeightLogScreen';
import { store } from '@/lib/store';
import { addDays, toDayKey } from '@/lib/date';

const profile = {
  sex: 'male' as const,
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate' as const,
  goal: 'maintain' as const,
};

function renderScreen(): void {
  render(
    <MemoryRouter>
      <WeightLogScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  store.reset();
  store.setProfile(profile);
});

describe('WeightLogScreen', () => {
  it('shows the empty state with no readings yet', () => {
    renderScreen();
    expect(screen.getByText(/no weight readings yet/i)).toBeInTheDocument();
  });

  it('adds a reading for an explicit date and lists it', async () => {
    const user = userEvent.setup();
    renderScreen();

    const dateField = screen.getByLabelText(/date/i);
    const weightField = screen.getByLabelText(/^weight$/i);
    await user.clear(dateField);
    await user.type(dateField, '2026-06-01');
    await user.type(weightField, '82.3');
    await user.click(screen.getByRole('button', { name: /save weight/i }));

    expect(await screen.findByText('82.3 kg')).toBeInTheDocument();
    expect(screen.queryByText(/no weight readings yet/i)).not.toBeInTheDocument();
  });

  it('asks to replace, not silently overwrite, an existing day', async () => {
    const user = userEvent.setup();
    const today = toDayKey();
    store.logWeight(80, today);
    renderScreen();

    const dateField = screen.getByLabelText(/date/i);
    const weightField = screen.getByLabelText(/^weight$/i);
    await user.clear(dateField);
    await user.type(dateField, today);
    await user.type(weightField, '81');
    await user.click(screen.getByRole('button', { name: /save weight/i }));

    // "already logged 80 kg" spans a nested <span>, so match the sentence and the
    // value as two separate, unambiguous assertions rather than one combined regex.
    expect(await screen.findByText(/you already logged/i)).toBeInTheDocument();
    expect(screen.getByText('81 kg')).toBeInTheDocument(); // unique here — the list row still says 80

    await user.click(screen.getByRole('button', { name: /^replace$/i }));

    expect(await screen.findByText('81 kg')).toBeInTheDocument();
    expect(screen.queryByText('80 kg')).not.toBeInTheDocument();
  });

  it('deletes a reading after an inline confirmation', async () => {
    const user = userEvent.setup();
    store.logWeight(79.5, addDays(toDayKey(), -3));
    renderScreen();

    expect(screen.getByText('79.5 kg')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /delete the reading/i }));
    expect(await screen.findByText(/delete the reading for/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.queryByText('79.5 kg')).not.toBeInTheDocument();
    expect(screen.getByText(/no weight readings yet/i)).toBeInTheDocument();
  });
});
