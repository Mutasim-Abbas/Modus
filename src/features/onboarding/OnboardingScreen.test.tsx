import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';
import { store } from '@/lib/store';
import { calculateTargets } from '@/lib/macros';

function renderScreen(): void {
  render(
    <MemoryRouter>
      <OnboardingScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  store.reset();
});

describe('OnboardingScreen', () => {
  it('renders labelled controls for every input the formula needs', () => {
    renderScreen();

    expect(screen.getByLabelText(/age/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/height/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Male' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Female' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /activity level/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /goal/i })).toBeInTheDocument();
  });

  // Corrected in Task 6 (P4.2, the project notes): "no server for your data" became false
  // the moment sync shipped — an account now genuinely can store your data on a server,
  // if you choose to create one. The honest claim now is "no account needed", not "no
  // server exists at all".
  it('states plainly that no account is needed and data stays on this device by default', () => {
    renderScreen();
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument();
    expect(screen.getByText(/stored on this device/i)).toBeInTheDocument();
  });

  it('shows no target preview until the inputs are valid — no placeholder numbers', () => {
    renderScreen();
    expect(screen.queryByText(/kcal \/ day/i)).not.toBeInTheDocument();
  });

  it('previews computed targets once the profile is complete', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText(/age/i), '30');
    await user.type(screen.getByLabelText(/height/i), '180');
    await user.type(screen.getByLabelText(/weight/i), '80');

    const expected = calculateTargets({
      sex: 'male',
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      goal: 'maintain',
    });

    expect(await screen.findByText(/kcal \/ day/i)).toBeInTheDocument();
    expect(screen.getByText(String(expected.kcal))).toBeInTheDocument();
    // Named in both the intro copy and the preview footnote — the formula is cited, not hidden.
    expect(screen.getAllByText(/mifflin-st jeor/i).length).toBeGreaterThan(0);
  });

  it('shows validation errors and does not save when fields are empty', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /start tracking/i }));

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(store.getState().profile).toBeNull();
  });

  it('rejects an out-of-range age rather than computing nonsense', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText(/age/i), '5');
    await user.type(screen.getByLabelText(/height/i), '180');
    await user.type(screen.getByLabelText(/weight/i), '80');
    await user.click(screen.getByRole('button', { name: /start tracking/i }));

    expect(await screen.findByText(/age must be between/i)).toBeInTheDocument();
    expect(store.getState().profile).toBeNull();
  });

  it('persists the profile and computed targets on submit', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('radio', { name: /female/i }));
    await user.type(screen.getByLabelText(/age/i), '28');
    await user.type(screen.getByLabelText(/height/i), '165');
    await user.type(screen.getByLabelText(/weight/i), '62');
    await user.click(screen.getByRole('radio', { name: /^cut/i }));
    await user.click(screen.getByRole('button', { name: /start tracking/i }));

    const state = store.getState();
    expect(state.profile).toMatchObject({ sex: 'female', age: 28, heightCm: 165, weightKg: 62, goal: 'cut' });
    expect(state.targets).toEqual(calculateTargets(state.profile!));
  });

  it('reflects the chosen goal adjustment in the preview', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText(/age/i), '30');
    await user.type(screen.getByLabelText(/height/i), '180');
    await user.type(screen.getByLabelText(/weight/i), '80');

    await user.click(screen.getByRole('radio', { name: /^cut/i }));
    expect(await screen.findByText(/goal adjustment -20%/i)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /^bulk/i }));
    expect(await screen.findByText(/goal adjustment 15%/i)).toBeInTheDocument();
  });
});
