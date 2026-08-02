import { useSyncExternalStore } from 'react';
import type { AppState } from '@/types';
import { store } from '@/lib/store';

/**
 * Subscribes a component to the whole store state.
 *
 * useSyncExternalStore keeps React 18 concurrent-safe and tear-free without a context
 * provider. State is immutable, so identity comparison does the right thing and the
 * snapshot is stable between commits.
 *
 * There is deliberately no selector argument: an inline selector would change identity
 * every render (forcing a resubscribe) and would loop forever if it built a new object.
 * The app is small — components read what they need and derive with useMemo.
 */
export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useStore(): typeof store {
  return store;
}
