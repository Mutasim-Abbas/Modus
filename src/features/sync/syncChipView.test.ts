import { describe, expect, it } from 'vitest';
import { deriveSyncChipView } from '@/features/sync/syncChipView';
import type { EngineState } from '@/lib/sync/engine';

function engineState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    userId: 'u1',
    activity: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
    lastErrorMessage: null,
    offline: false,
    needsMerge: false,
    postponed: false,
    ...overrides,
  };
}

describe('deriveSyncChipView — docs/DESIGN.md §7.10, all six rows', () => {
  it('unconfigured: the chip is not rendered at all', () => {
    expect(deriveSyncChipView('unconfigured', engineState())).toBeNull();
  });

  it('guest (including "loading"): "On this device only"', () => {
    expect(deriveSyncChipView('guest', engineState())).toEqual({ state: 'guest', text: 'On this device only' });
    expect(deriveSyncChipView('loading', engineState())?.state).toBe('guest');
  });

  it('synced: "Synced · N ago"', () => {
    const now = Date.parse('2026-03-12T14:04:00.000Z');
    const lastSyncedAt = Date.parse('2026-03-12T14:02:00.000Z');
    const view = deriveSyncChipView('signed-in', engineState({ lastSyncedAt }), now);
    expect(view).toEqual({ state: 'synced', text: 'Synced · 2 min ago' });
  });

  it('syncing: shows while a push/pull is in flight', () => {
    expect(deriveSyncChipView('signed-in', engineState({ activity: 'syncing' }))).toEqual({
      state: 'syncing',
      text: 'Syncing…',
    });
  });

  it('queued: offline with pending changes', () => {
    expect(deriveSyncChipView('signed-in', engineState({ offline: true, pendingCount: 4 }))).toEqual({
      state: 'queued',
      text: 'Offline · 4 changes queued',
    });
  });

  it('error: sync failed', () => {
    expect(deriveSyncChipView('signed-in', engineState({ activity: 'error' }))).toEqual({
      state: 'error',
      text: 'Sync failed',
    });
  });

  it('postponed/needs-merge takes priority over every other state, with a resume link', () => {
    const view = deriveSyncChipView('signed-in', engineState({ postponed: true, activity: 'error', offline: true }));
    expect(view?.state).toBe('queued');
    expect(view && 'resumeHref' in view ? view.resumeHref : undefined).toBe('/sync/merge');
  });
});
