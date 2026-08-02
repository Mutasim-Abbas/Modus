import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// This file runs for every test file regardless of `// @vitest-environment` — some
// backend suites (e.g. api/_lib/db/schema.test.ts) deliberately opt into the plain
// `node` environment instead of the project-wide `jsdom` default, because a real
// WASM Postgres (PGlite) needs Node's native fetch/Response, which jsdom shadows with
// an incompatible shim. `window`/`localStorage` do not exist under `node`, so every
// DOM-only step below is guarded rather than assumed.
const hasDom = typeof window !== 'undefined';

afterEach(() => {
  if (hasDom) {
    cleanup();
    localStorage.clear();
  }
  vi.restoreAllMocks();
});

// jsdom does not implement matchMedia; motion + reduced-motion checks rely on it.
if (hasDom && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
