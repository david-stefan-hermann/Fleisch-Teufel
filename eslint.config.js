import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/*.gen.ts',
      'apps/api/drizzle/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // One design language for tappable elements (docs/plans/2026-11-bedienelemente.md).
    files: ['apps/web/**/*.tsx'],
    ignores: ['apps/web/src/components/ui/**', 'apps/web/src/components/tappable.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'Literal[value=/hover:bg-accent|(^|\\s)underline(\\s|$)/]',
          'TemplateElement[value.raw=/hover:bg-accent|(^|\\s)underline(\\s|$)/]',
        ].map((selector) => ({
          selector,
          message: 'Use rowClass, InlineTarget, FooterRow or TextLink from components/tappable',
        })),
      ],
    },
  },
);
