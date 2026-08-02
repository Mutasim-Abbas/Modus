import type { Config } from 'tailwindcss';

/**
 * Design tokens are defined once in src/styles/tokens.css and mapped here to Tailwind
 * utility names. Components must consume the semantic names (bg-surface, text-gold,
 * bg-fm-card, text-fm-accent, …) — never raw hex. See docs/DESIGN.md §13.2.
 */
/**
 * Every colour token is a CSS variable, and several are now aliases of other variables
 * (`--surface: var(--fm-surface-1)`). Tailwind cannot compute an alpha channel through a
 * `var()` it can't resolve at build time, so the plain string form silently breaks every
 * `bg-surface/90`-style utility — erroring under `@apply`, and worse, quietly emitting
 * nothing in `.tsx`, leaving elements with no background at all.
 *
 * The function form fixes it in one place: Tailwind passes `opacityValue` when a modifier
 * is used, and `color-mix()` applies the alpha at runtime, where the variable IS resolved.
 */
const tok =
  (cssVar: string) =>
  ({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined
      ? `var(${cssVar})`
      : `color-mix(in srgb, var(${cssVar}) calc(${opacityValue} * 100%), transparent)`;

/** Token names map 1:1 onto `--<name>` CSS variables in src/styles/tokens.css. */
const TOKEN_NAMES = [
  // v2 aliases — kept as pass-throughs, see src/styles/tokens.css
  'black', 'black-soft', 'surface', 'surface-2', 'surface-3', 'white', 'gray', 'gray-soft',
  'gold', 'gold-light', 'gold-dim', 'danger', 'success', 'protein', 'carbs', 'fat',
  // fm-* — Direction A ("Bullion") semantic tokens, docs/DESIGN.md §2.2
  'fm-bg', 'fm-bg-elevated', 'fm-text', 'fm-text-muted', 'fm-text-subtle', 'fm-text-faint',
  'fm-text-disabled', 'fm-text-on-accent', 'fm-accent', 'fm-accent-hover',
  'fm-accent-press', 'fm-accent-quiet', 'fm-focus', 'fm-card', 'fm-field', 'fm-chip',
  'fm-hover', 'fm-ok', 'fm-ok-bg', 'fm-warn', 'fm-warn-bg', 'fm-danger', 'fm-danger-bg',
  'fm-info', 'fm-info-bg', 'fm-data-protein', 'fm-data-carbs', 'fm-data-fat',
  'fm-data-energy', 'fm-data-grid', 'fm-data-axis', 'fm-data-ref', 'fm-border-field',
  'fm-border-neutral',
] as const;

/* Tailwind accepts a function per colour at runtime, but its published types only admit
   strings, so the cast is required — not a shortcut around a real type error. */
const tokenColors = Object.fromEntries(
  TOKEN_NAMES.map((n) => [n, tok(`--${n}`)]),
) as unknown as Record<string, string>;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...tokenColors,
      },
      borderColor: {
        DEFAULT: 'var(--border)',
        strong: 'var(--border-strong)',
      },
      borderRadius: {
        xs: '6px',
        sm: '10px',
        md: '14px',
        lg: '22px',
        xl: '28px',
      },
      fontFamily: {
        sans: [
          'var(--fm-font-sans)',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Arial',
          'sans-serif',
        ],
        mono: ['var(--fm-font-mono)', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      maxWidth: {
        app: '480px',
        content: '1100px',
        'content-xl': '1200px',
        'content-2xl': '1320px',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.22,1,.36,1)',
        emphasis: 'cubic-bezier(.22,1,.36,1)',
        standard: 'cubic-bezier(.2,0,0,1)',
        exit: 'cubic-bezier(.4,0,1,1)',
      },
      transitionDuration: {
        1: '120ms',
        2: '180ms',
        3: '240ms',
        4: '320ms',
        5: '520ms',
      },
      boxShadow: {
        e1: '0 1px 2px rgba(0,0,0,.45)',
        e2: '0 4px 16px -4px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.40)',
        e3: '0 12px 32px -8px rgba(0,0,0,.65), 0 2px 6px rgba(0,0,0,.45)',
        accent: '0 8px 28px -10px rgba(212,175,55,.28)',
      },
      backgroundImage: {
        'app-glow': 'radial-gradient(ellipse 120% 80% at 50% -10%, #1c1a15 0%, var(--black) 55%)',
        'gold-mark': 'linear-gradient(145deg, var(--gold-light), var(--gold) 55%, var(--gold-dim))',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [],
} satisfies Config;
