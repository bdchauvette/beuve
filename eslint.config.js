import e18e from '@e18e/eslint-plugin';
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import { configs as litConfigs } from 'eslint-plugin-lit';
import n from 'eslint-plugin-n';
import promise from 'eslint-plugin-promise';
import security from 'eslint-plugin-security';
import unicorn from 'eslint-plugin-unicorn';
import { configs as wcConfigs } from 'eslint-plugin-wc';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { convertedTestDirs } from './converted-test-dirs.ts';
import { localRulesPlugin } from './eslint-local-rules/local-rules-plugin.ts';

const uiFiles = ['src/ui/**/*.ts'];
const nodeFiles = ['**/*.{js,ts}'];
const testFiles = ['**/*.test.ts'];
const entrypointFiles = [
  'src/*/index.ts',
  'scripts/**/*.ts',
  'src/main/impact/impact-worker.ts',
  'src/main/impact/testing/scripted-impact-worker.ts',
];
const configFiles = ['*.config.{js,ts}', '.dependency-cruiser.js', 'types/**/*.d.ts'];
const convertedTestFiles = convertedTestDirs.map((directory) => `${directory}/*.test.ts`);
const timedFiles = ['src/**/*.ts', 'scripts/**/*.ts'];

export default defineConfig(
  globalIgnores(['dist/', 'out/', 'coverage/']),

  {
    name: 'beuve/linter-options',
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  unicorn.configs.recommended,
  security.configs.recommended,
  e18e.configs.recommended,

  {
    name: 'beuve/typescript',
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
    },
  },

  {
    name: 'beuve/style',
    rules: {
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      // Flags db, err, utils, props and other standard vocabulary; reviewers police naming.
      'unicorn/name-replacements': 'off',
      // Unicorn's default wants one-line `/** … */` doc comments split over three lines.
      'unicorn/single-line-block-comment-style': ['error', 'single-line'],
      // Forbids the ` * ` prefix of standard JSDoc/TSDoc blocks that editors and tsc render.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      // Every `obj[key]` is flagged; noUncheckedIndexedAccess already makes lookups safe.
      'security/detect-object-injection': 'off',
      // A review tool reads arbitrary repository paths by design; every fs call would fire.
      'security/detect-non-literal-fs-filename': 'off',
      // Vitest fixtures must destructure their first parameter, even when they use nothing.
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },

  {
    name: 'beuve/local-rules',
    plugins: { local: localRulesPlugin },
    rules: {
      'local/enforce-single-named-export': 'error',
      'local/export-name-matches-filename': 'error',
      'local/no-barrel-files': 'error',
      'local/enforce-internal-utils': 'error',
      'local/enforce-top-level-function-syntax': 'error',
    },
  },

  {
    name: 'beuve/node',
    files: nodeFiles,
    ignores: uiFiles,
    extends: [n.configs['flat/recommended-module'], promise.configs['flat/recommended']],
    languageOptions: { globals: globals.node },
    rules: {
      'promise/prefer-await-to-then': 'error',
      'promise/prefer-await-to-callbacks': 'off',
      // TypeScript resolves every import, including `#x/*` aliases, more precisely.
      'n/no-missing-import': 'off',
      // Electron is a devDependency by convention but is provided at runtime.
      'n/no-unpublished-import': ['error', { allowModules: ['electron'] }],
      'n/no-extraneous-import': ['error', { allowModules: ['electron'] }],
      // node:sqlite is release-candidate and wrapped by #sqlite (ADR 0004).
      'n/no-unsupported-features/node-builtins': [
        'error',
        { ignores: ['sqlite', 'sqlite.DatabaseSync', 'import.meta.dirname'] },
      ],
    },
  },

  {
    name: 'beuve/electron-node',
    files: ['src/**/*.ts'],
    ignores: [...uiFiles, ...testFiles, '**/testing/**'],
    // Shipped code runs on Electron 45's Node 24; tooling and tests run on Node 26 (ADR 0060).
    settings: { n: { version: '>=24.22.0' } },
  },

  {
    name: 'beuve/ui',
    files: uiFiles,
    extends: [wcConfigs['flat/best-practice'], litConfigs['flat/recommended']],
    languageOptions: { globals: globals.browser },
    settings: { wc: { elementBaseClasses: ['LitElement'] } },
  },

  {
    name: 'beuve/time',
    // ADR 0059: Temporal only. Applies to shipped code, scripts and converted tests.
    files: timedFiles,
    ignores: testFiles,
    rules: {
      'local/no-date': 'error',
      'local/no-time-number-arithmetic': 'error',
    },
  },

  {
    name: 'beuve/time-in-converted-tests',
    files: convertedTestFiles,
    rules: {
      'local/no-date': 'error',
      'local/no-time-number-arithmetic': 'error',
    },
  },

  {
    name: 'beuve/time-foreign-dates',
    // Records arbitrary values from the program under test, which may be Dates (ADR 0036).
    files: ['src/internal/trace/create-trace-recorder.ts'],
    rules: {
      'local/no-date': ['error', { allowGlobalUses: ['instanceof', 'prototype'] }],
    },
  },

  {
    name: 'beuve/converted-tests',
    // ADR 0058. Directories join `convertedTestDirs` as they are converted.
    files: convertedTestFiles,
    plugins: { vitest },
    settings: { vitest: { vitestImports: [/(^#|\/)testing\/test\.ts$/u] } },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/consistent-test-it': ['error', { fn: 'test', withinDescribe: 'test' }],
      'vitest/consistent-vitest-vi': ['error', { fn: 'vi' }],
      'vitest/hoisted-apis-on-top': 'error',
      'vitest/max-nested-describe': ['error', { max: 2 }],
      'vitest/no-alias-methods': 'error',
      'vitest/no-commented-out-tests': 'error',
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/no-conditional-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-hooks': 'error',
      'vitest/no-mocks-import': 'error',
      'vitest/no-restricted-vi-methods': [
        'error',
        {
          mock: 'Inject the dependency instead of mocking the module (ADR 0058).',
          doMock: 'Inject the dependency instead of mocking the module (ADR 0058).',
          unmock: 'Modules are never mocked (ADR 0058).',
          doUnmock: 'Modules are never mocked (ADR 0058).',
          hoisted: 'Modules are never mocked, so nothing needs hoisting (ADR 0058).',
          importActual: 'Modules are never mocked (ADR 0058).',
          importMock: 'Modules are never mocked (ADR 0058).',
          resetModules: 'Modules are never mocked (ADR 0058).',
          stubGlobal: 'Globals are shared by concurrent tests; inject the dependency (ADR 0058).',
          stubEnv: 'process.env is shared by concurrent tests; inject the environment (ADR 0058).',
        },
      ],
      'vitest/no-standalone-expect': 'error',
      'vitest/no-test-prefixes': 'error',
      'vitest/no-test-return-statement': 'error',
      'vitest/no-unneeded-async-expect-function': 'error',
      'vitest/prefer-comparison-matcher': 'error',
      'vitest/prefer-each': 'error',
      'vitest/prefer-equality-matcher': 'error',
      'vitest/prefer-expect-resolves': 'error',
      'vitest/prefer-mock-promise-shorthand': 'error',
      'vitest/prefer-spy-on': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-be-object': 'error',
      'vitest/prefer-to-contain': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/prefer-todo': 'error',
      'vitest/prefer-vi-mocked': 'error',
      'vitest/require-awaited-expect-poll': 'error',
      'vitest/require-local-test-context-for-concurrent-snapshots': 'error',
      'vitest/require-to-throw-message': 'error',
      'vitest/valid-expect-in-promise': 'error',
      'vitest/valid-title': 'error',
      // Regex literals stay inside the test: module-scope bindings are banned in tests.
      'e18e/prefer-static-regex': 'off',
      'local/expect-from-test-context': 'error',
      'local/no-module-mocking': 'error',
      'local/no-module-scope-bindings': 'error',
      'local/require-sequential-fake-time': ['error', { fixtures: ['clock'] }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vitest',
              importNames: [
                'beforeAll',
                'beforeEach',
                'afterAll',
                'afterEach',
                'aroundAll',
                'aroundEach',
                'onTestFailed',
                'onTestFinished',
              ],
              message: 'Set up and tear down in fixtures (`test.extend`, ADR 0058).',
            },
            {
              name: 'vitest',
              importNames: ['test', 'it'],
              message: "Import `test` from the nearest `testing/test.ts` (or '#testing/test.ts').",
            },
          ],
        },
      ],
    },
  },

  {
    name: 'beuve/entrypoints-and-tests',
    files: [...entrypointFiles, ...testFiles],
    rules: {
      'local/enforce-single-named-export': ['error', { allowNoExports: true }],
    },
  },

  {
    name: 'beuve/config-files',
    files: configFiles,
    rules: {
      'local/enforce-single-named-export': 'off',
      'local/export-name-matches-filename': 'off',
    },
  },

  prettier,
);
