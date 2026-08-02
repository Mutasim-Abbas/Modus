/**
 * A minimal, app-wide toast queue (docs/DESIGN.md §8.7). Module-level singleton with
 * `subscribe`/`getState`, the same pattern as `src/lib/store.ts` — so it can be pushed
 * to from anywhere (including `src/lib/sync/signInFlow.ts`, which runs before
 * `<AppShell>` — and therefore any toast host mounted inside it — even exists) without
 * needing a React context provider threaded through screens that render outside it.
 */

export interface Toast {
  id: string;
  message: string;
  /** `success` -> role="status"; `error` -> role="alert" (docs/DESIGN.md §8.7). */
  tone: 'success' | 'error';
}

type Listener = () => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getToasts(): Toast[] {
  return toasts;
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pushToast(message: string, tone: Toast['tone'] = 'success'): string {
  counter += 1;
  const id = `toast-${counter}`;
  toasts = [...toasts, { id, message, tone }];
  notify();
  return id;
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

/** Test-only: clears every queued toast. */
export function resetToasts(): void {
  toasts = [];
  notify();
}
