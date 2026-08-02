import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultAccountSyncState,
  loadAccountSyncState,
  saveAccountSyncState,
  updateAccountSyncState,
} from '@/lib/sync/persist';

beforeEach(() => {
  localStorage.clear();
});

describe('per-account sync persistence', () => {
  it('returns the default (unresolved, no cursor) state for an account never seen before', () => {
    const state = loadAccountSyncState('user-1');
    expect(state).toEqual(defaultAccountSyncState());
  });

  it('survives a "refresh" — a fresh read after a save gets the same values back', () => {
    const cursor = { profile: null, settings: null, entries: { updatedAt: '2026-01-01T00:00:00.000Z', id: 'e1' }, weights: null, customFoods: null, favourites: null };
    saveAccountSyncState('user-1', { ...defaultAccountSyncState(), pullCursor: cursor, resolved: true, acked: { entries: { e1: 123 }, weights: {}, customFoods: {}, favourites: {} } });

    const reloaded = loadAccountSyncState('user-1');
    expect(reloaded.pullCursor).toEqual(cursor);
    expect(reloaded.resolved).toBe(true);
    expect(reloaded.acked.entries).toEqual({ e1: 123 });
  });

  it('scopes state per account — signing into a different account never inherits the first account\'s cursor', () => {
    const cursorA = { profile: null, settings: null, entries: { updatedAt: '2026-01-01T00:00:00.000Z', id: 'e1' }, weights: null, customFoods: null, favourites: null };
    saveAccountSyncState('account-A', { ...defaultAccountSyncState(), pullCursor: cursorA, resolved: true });

    const accountB = loadAccountSyncState('account-B');
    expect(accountB.pullCursor).toBeNull();
    expect(accountB.resolved).toBe(false);

    // Saving account B's state must not disturb account A's.
    saveAccountSyncState('account-B', { ...defaultAccountSyncState(), resolved: true });
    expect(loadAccountSyncState('account-A').pullCursor).toEqual(cursorA);
  });

  it('updateAccountSyncState reads the latest value before writing (read-modify-write)', () => {
    saveAccountSyncState('user-1', { ...defaultAccountSyncState(), lastSyncedAt: 100 });
    const result = updateAccountSyncState('user-1', (prev) => ({ ...prev, resolved: true }));
    expect(result.lastSyncedAt).toBe(100);
    expect(result.resolved).toBe(true);
    expect(loadAccountSyncState('user-1').resolved).toBe(true);
  });

  it('degrades to defaults rather than throwing on a corrupted blob', () => {
    localStorage.setItem('fitmacro.sync.v1', '{not valid json');
    expect(loadAccountSyncState('user-1')).toEqual(defaultAccountSyncState());

    localStorage.setItem('fitmacro.sync.v1', JSON.stringify({ accounts: { 'user-1': { acked: 'not an object' } } }));
    expect(loadAccountSyncState('user-1').acked).toEqual({ entries: {}, weights: {}, customFoods: {}, favourites: {} });
  });

  it('postponed and resolved are independent, persisted flags', () => {
    saveAccountSyncState('user-1', { ...defaultAccountSyncState(), postponed: true, resolved: false });
    const reloaded = loadAccountSyncState('user-1');
    expect(reloaded.postponed).toBe(true);
    expect(reloaded.resolved).toBe(false);
  });
});
