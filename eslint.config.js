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

import { localRulesPlugin } from './eslint-local-rules/local-rules-plugin.ts';

const uiFiles = ['src/ui/**/*.ts'];
const nodeFiles = ['**/*.{js,ts}'];
const testFiles = ['**/*.test.ts'];
const entrypointFiles = [
  'src/*/index.ts',
  'src/preload/sheet-preload.ts',
  'src/preload/settings-preload.ts',
  'src/ui/sheet-entry.ts',
  'src/ui/settings-entry.ts',
  'src/ui/testing/hostile-harness-entry.ts',
  'scripts/**/*.ts',
  'src/main/impact/impact-worker.ts',
  'src/main/impact/testing/scripted-impact-worker.ts',
];
const configFiles = ['*.config.{js,ts}', '.dependency-cruiser.js', 'types/**/*.d.ts'];
const blockingProcessImports = ['node:child_process', 'child_process'].map((name) => {
  return {
    name,
    importNames: ['execFileSync', 'execSync', 'spawnSync'],
    message:
      'Synchronous child processes block the worker, so concurrent tests cannot overlap and every test timeout covers the whole file. Use `execFile` from `node:child_process` through `promisify` (ADR 0058).',
  };
});
const renameImports = ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map((name) => {
  return {
    name,
    importNames: ['rename', 'renameSync'],
    message:
      'Replace a file through `writeFileAtomic` (`#x/fs/write-file-atomic.ts`): a unique temporary name created exclusively with its mode, fsync, rename, fsync of the directory (ADR 0082).',
  };
});
const timedFiles = ['src/**/*.ts', 'scripts/**/*.ts'];
const staticOrStandalone =
  'Name a standalone or static conversion `yFrom(x)` or `Y.fromX(x)`, not `toY`; `toY()` is for instance methods (ADR 0062, CLAUDE.md "Conversion naming").';
const instanceMethod =
  'Name an instance conversion `x.toY()`, not `fromY`; `fromX` is for static factories and standalone `yFrom` functions (ADR 0062, CLAUDE.md "Conversion naming").';
const functionValue = '/^(ArrowFunctionExpression|FunctionExpression)$/';
const conversionNamingSelectors = [
  {
    selector: 'FunctionDeclaration[id.name=/^to[A-Z]/]',
    message: staticOrStandalone,
  },
  {
    selector: `VariableDeclarator[id.name=/^to[A-Z]/][init.type=${functionValue}]`,
    message: staticOrStandalone,
  },
  {
    selector: 'MethodDefinition[static=true][kind="method"][key.name=/^to[A-Z]/]',
    message: staticOrStandalone,
  },
  {
    selector: `PropertyDefinition[static=true][key.name=/^to[A-Z]/][value.type=${functionValue}]`,
    message: staticOrStandalone,
  },
  {
    selector: 'MethodDefinition[static=false][kind="method"][key.name=/^from[A-Z]/]',
    message: instanceMethod,
  },
  {
    selector: `PropertyDefinition[static=false][key.name=/^from[A-Z]/][value.type=${functionValue}]`,
    message: instanceMethod,
  },
];

/** HTML string sinks the renderer never uses (ADR 0077); `Element.setHTML` is the sanctioned path. */
const htmlSinkMessage =
  'No HTML string sinks in the renderer: build nodes (Lit templates, `textContent`, `createElement`). To render an HTML string, use `element.setHTML(html, { sanitizer })`, the Sanitizer API (ADR 0077).';
const htmlSinkSelectors = [
  {
    selector:
      'AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML|srcdoc)$/]',
    message: htmlSinkMessage,
  },
  {
    selector:
      'CallExpression > MemberExpression.callee[property.name=/^(insertAdjacentHTML|createContextualFragment|setHTMLUnsafe|parseHTMLUnsafe)$/]',
    message: htmlSinkMessage,
  },
  {
    selector:
      "CallExpression > MemberExpression.callee[object.name='document'][property.name=/^(write|writeln)$/]",
    message: htmlSinkMessage,
  },
];
const htmlSinkImports = ['lit', 'lit-html'].flatMap((root) => {
  return ['unsafe-html', 'unsafe-svg', 'unsafe-mathml'].map((directive) => {
    return {
      name: `${root}/directives/${directive}.js`,
      message: htmlSinkMessage,
    };
  });
});

export default defineConfig(
  globalIgnores(['dist/', 'dist-test/', 'out/', 'coverage/', '.claude/worktrees/']),

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
    name: 'beuve/modern-apis',
    rules: {
      // Iterator.zip is missing on Node 26, where tests run (ADR 0080).
      'unicorn/prefer-iterator-zip': 'off',
      'unicorn/prefer-error-is-error': 'error',
      'e18e/prefer-get-or-insert': 'error',
      'unicorn/prefer-uint8array-base64': 'error',
      'unicorn/prefer-uint8array-hex': 'error',
      'unicorn/prefer-regexp-escape': 'error',
    },
  },

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
      // `using _timer = setTimeout(…)` exists to be disposed (ADR 0076); tsc wants the `_`.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreUsingDeclarations: true }],
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
      // ADR 0075.
      'local/forward-abort-signal': 'error',
      // ADR 0076.
      'local/prefer-using': 'error',
      // ADR 0080.
      'local/prefer-error-from': 'error',
      'local/no-hand-formatted-duration': 'error',
      'local/prefer-url-parse': 'error',
      'local/no-string-tail-slice': 'error',
    },
  },

  {
    name: 'beuve/no-electron-as-node',
    // ADR 0083: the runAsNode fuse is off; Node children run the resolved Node with `spawn`.
    // Tests may name the variable to check that environments drop it.
    files: ['src/main/**/*.ts', 'src/internal/**/*.ts'],
    ignores: testFiles,
    rules: {
      'local/no-electron-as-node': 'error',
    },
  },

  {
    // Phase 2 of ADR 0086: switched on, and the whole repo fixed, in a later change. The levels
    // here are 'off' so the rules are registered and measurable with `--rule`.
    name: 'beuve/style-rules-phase-2',
    plugins: { local: localRulesPlugin },
    rules: {
      'local/no-ternary-outside-templates': 'off',
      'no-nested-ternary': 'off',
      'local/arrow-body-braces': 'off',
      'local/no-inline-object-type-in-signature': 'off',
      'local/no-same-type-positional-params': 'off',
      curly: ['off', 'all'],
      'max-params': 'off',
      '@typescript-eslint/max-params': ['off', { max: 3 }],
    },
  },

  {
    name: 'beuve/conversion-naming',
    // ADR 0062.
    files: nodeFiles,
    rules: {
      'no-restricted-syntax': ['error', ...conversionNamingSelectors],
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
    name: 'beuve/ui-html-sinks',
    // ADR 0077: no HTML string sinks in our renderer code, so a Trusted Types policy has nothing of ours to admit.
    files: uiFiles,
    rules: {
      'no-restricted-syntax': ['error', ...conversionNamingSelectors, ...htmlSinkSelectors],
      'no-restricted-imports': ['error', { paths: htmlSinkImports }],
    },
  },

  {
    name: 'beuve/ui-event-delegation',
    // ADR 0074: repeated templates delegate their events to the component root.
    files: uiFiles,
    ignores: [...testFiles, '**/testing/**'],
    rules: {
      'local/no-listener-in-repeated-template': 'error',
    },
  },

  {
    name: 'beuve/time',
    // ADR 0059: Temporal only. Applies to shipped code, scripts and tests.
    files: timedFiles,
    ignores: testFiles,
    rules: {
      'local/no-date': 'error',
      'local/no-time-number-arithmetic': 'error',
    },
  },

  {
    name: 'beuve/time-in-tests',
    files: testFiles,
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
    name: 'beuve/tests',
    // ADR 0058.
    files: testFiles,
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
            ...blockingProcessImports,
          ],
        },
      ],
    },
  },

  {
    // ADR 0082: shipped code opens a path once; tests and their helpers stat their own fixtures.
    name: 'beuve/no-check-then-open',
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    ignores: [...testFiles, '**/testing/**'],
    rules: {
      'local/no-check-then-open': 'error',
    },
  },

  {
    name: 'beuve/atomic-file-writes',
    files: ['src/**/*.ts'],
    ignores: [...uiFiles, ...testFiles, '**/testing/**', 'src/x/fs/write-file-atomic.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: renameImports }],
    },
  },

  {
    name: 'beuve/testing-helpers-do-not-block',
    files: ['src/**/testing/**/*.ts', 'src/testing/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: blockingProcessImports }],
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
