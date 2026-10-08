// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const WEB_FILES = ['apps/web/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    '**/next-env.d.ts',
    'apps/api/src/generated/**',
  ]),

  // ---------------------------------------------------------------- Next.js web app (first, so the TypeScript block below wins on parser)
  ...nextVitals.map((config) => ({
    ...config,
    files: config.files ? config.files.map((f) => `apps/web/${f}`) : WEB_FILES,
  })),
  {
    files: WEB_FILES,
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: 'apps/web/' } },
    // App Router only - there is no pages/ directory to check links against.
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },

  // ---------------------------------------------------------------- TypeScript (all packages)
  {
    files: ['**/*.{ts,tsx,mts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['error', 'warn', 'log'] }],
    },
  },

  // NestJS relies on runtime class references for DI - type-only imports would break injection.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },

  // Tests poke at loosely-typed HTTP bodies.
  {
    files: ['apps/api/test/**/*.ts', '**/*.spec.ts', 'apps/api/src/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },

  prettier,
]);
