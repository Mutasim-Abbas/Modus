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
  // fm-* — "Nocturne" semantic tokens, src/styles/tokens.css
  'fm-bg', 'fm-bg-elevated', 'fm-text', 'fm-text-muted', 'fm-text-subtle', 'fm-text-faint',
  'fm-text-disabled', 'fm-text-on-accent', 'fm-accent', 'fm-accent-hover',
  'fm-accent-press', 'fm-accent-quiet', 'fm-accent-fill', 'fm-accent-fill-strong',
  'fm-accent-2', 'fm-accent-2-ink', 'fm-accent-2-quiet',
  'fm-focus', 'fm-card', 'fm-field', 'fm-chip',
  'fm-hover', 'fm-ok', 'fm-ok-bg', 'fm-warn', 'fm-warn-bg', 'fm-danger', 'fm-danger-bg',
  'fm-info', 'fm-info-bg', 'fm-data-protein', 'fm-data-carbs', 'fm-data-fat',
  'fm-data-energy', 'fm-data-grid', 'fm-data-axis', 'fm-data-ref', 'fm-border-field',
  'fm-border-neutral',
  'fm-surface-0', 'fm-surface-1', 'fm-surface-2', 'fm-surface-3', 'fm-surface-4',
  'fm-violet-200', 'fm-violet-300', 'fm-violet-400', 'fm-violet-500', 'fm-violet-600',
  'fm-cyan-300', 'fm-cyan-400', 'fm-cyan-600',
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
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '22px',
        xl: '28px',
        '2xl': '32px',
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
        /* Numerals only — `font-num` pairs with `tabular-nums` so figures hold their
           column as a count ticks up. Never apply to running text: no Arabic coverage. */
        num: ['var(--fm-font-num)', 'ui-monospace', 'monospace'],
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
        e1: '0 1px 2px rgba(0,0,0,.5)',
        e2: '0 8px 24px -8px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.40)',
        e3: '0 24px 56px -12px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.45)',
        e4: '0 30px 80px rgba(0,0,0,.6)',
        accent: '0 12px 30px -8px rgba(124,58,237,.45)',
        cyan: '0 12px 30px -8px rgba(34,211,238,.32)',
      },
      backgroundImage: {
        /* The page wash from both mocks: a violet bloom off the top-right, a faint cyan
           one bottom-left, over the flat page colour. */
        'app-glow':
          'radial-gradient(1100px 620px at 82% -14%, rgba(124,58,237,.22), transparent 62%), radial-gradient(820px 560px at 0% 104%, rgba(34,211,238,.07), transparent 60%)',
        /* Named `gold-mark` for the Bullion-era call sites; it is violet now. */
        'gold-mark': 'var(--fm-grad-accent)',
        'accent-mark': 'var(--fm-grad-accent)',
        'accent-soft': 'var(--fm-grad-accent-soft)',
        'cyan-mark': 'var(--fm-grad-cyan)',
        /* The tinted hero panel that holds the calorie ring and the "how it's computed"
           card — violet wash fading into the card colour. */
        'card-violet':
          'linear-gradient(160deg, rgba(139,92,246,.17), rgba(26,28,40,.96) 48%), #1a1c28',
        'card-cyan':
          'linear-gradient(160deg, rgba(34,211,238,.14), rgba(26,28,40,.96) 52%), #1a1c28',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fm-rise': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fm-pop': {
          from: { opacity: '0', transform: 'translateY(24px) scale(.97)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fm-sheet': {
          from: { opacity: '0', transform: 'translateY(60px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fm-pulse': {
          '0%,100%': { opacity: '.5' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s cubic-bezier(.22,1,.36,1) both',
        rise: 'fm-rise .5s cubic-bezier(.22,1,.36,1) both',
        pop: 'fm-pop .28s cubic-bezier(.22,1,.36,1) both',
        sheet: 'fm-sheet .26s cubic-bezier(.22,1,.36,1) both',
        'pulse-soft': 'fm-pulse 2.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
