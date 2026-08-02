import { useSyncExternalStore } from 'react';
import { syncEngine } from '@/lib/sync/engine';
import type { EngineState } from '@/lib/sync/engine';

/** Subscribes a component to the background sync engine's state — no provider needed,
 *  same pattern as `src/lib/useStore.ts`'s `useAppState()`. */
export function useSyncEngineState(): EngineState {
  return useSyncExternalStore(syncEngine.subscribe.bind(syncEngine), syncEngine.getState.bind(syncEngine));
}
