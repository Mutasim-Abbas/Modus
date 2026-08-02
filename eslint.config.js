import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'legacy', 'coverage', 'api', 'e2e', 'drizzle'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'vitest.setup.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // RTL prep (docs/DESIGN.md §10/§13.2): Tailwind ships logical-property utilities
    // (ps-/pe-/ms-/me-/start-/end-/border-s/border-e/rounded-s/rounded-e/text-start/
    // text-end) that flip automatically under `dir="rtl"`. Physical left/right utilities
    // don't, so they're banned in component markup — this is the enforcement half of
    // that migration; the other half was doing the sweep itself.
    files: ['src/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/(^|[\\s\"'`])(pl|pr|ml|mr)-|(^|[\\s\"'`])(left|right)-[0-9[]|\\btext-(left|right)\\b|\\bfloat-(left|right)\\b|\\borigin-(left|right)\\b|\\brounded-(l|r)(-|\\b)|\\bborder-(l|r)(-|\\b)/]",
          message:
            'Use a logical-property Tailwind utility (ps-/pe-/ms-/me-/start-/end-/text-start/text-end/rounded-s/rounded-e/border-s/border-e) instead of a physical left/right one — see docs/DESIGN.md §10.',
        },
        {
          selector:
            "TemplateElement[value.raw=/(^|[\\s\"'`])(pl|pr|ml|mr)-|(^|[\\s\"'`])(left|right)-[0-9[]|\\btext-(left|right)\\b|\\bfloat-(left|right)\\b|\\borigin-(left|right)\\b|\\brounded-(l|r)(-|\\b)|\\bborder-(l|r)(-|\\b)/]",
          message:
            'Use a logical-property Tailwind utility (ps-/pe-/ms-/me-/start-/end-/text-start/text-end/rounded-s/rounded-e/border-s/border-e) instead of a physical left/right one — see docs/DESIGN.md §10.',
        },
      ],
    },
  },
  {
    files: [
      'vite.config.ts',
      'tailwind.config.ts',
      'eslint.config.js',
      'postcss.config.js',
      'drizzle.config.ts',
      'playwright.config.ts',
    ],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
);
