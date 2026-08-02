import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAuthAvailability,
  markAuthAvailable,
  markAuthUnavailable,
  resetAuthAvailability,
} from '@/features/auth/authAvailability';
import { AuthError } from '@/lib/authApi';

beforeEach(() => {
  resetAuthAvailability();
});

describe('authAvailability — mirrors src/features/scan/availability.ts', () => {
  it('starts unknown', () => {
    expect(getAuthAvailability()).toBe('unknown');
  });

  it('becomes available after a successful call', () => {
    markAuthAvailable();
    expect(getAuthAvailability()).toBe('available');
  });

  it('becomes unavailable only for a sync_unconfigured error', () => {
    markAuthUnavailable(new AuthError('sync_unconfigured', ''));
    expect(getAuthAvailability()).toBe('unavailable');
  });

  it('ignores a transient error — it must not hide auth for a one-off network blip', () => {
    markAuthUnavailable(new AuthError('network', ''));
    expect(getAuthAvailability()).toBe('unknown');

    markAuthUnavailable(new AuthError('rate_limited', ''));
    expect(getAuthAvailability()).toBe('unknown');
  });
});
