import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { detectLanguage } from './detect-language.ts';

describe('detectLanguage', () => {
  test.for([
    ['src/a.ts', 'typescript'],
    ['types/env.d.ts', 'typescript'],
    ['x/y.MTS', 'typescript'],
    ['view.tsx', 'tsx'],
    ['lib/index.js', 'javascript'],
    ['app.jsx', 'javascript'],
    ['config.cjs', 'javascript'],
  ] as const)('detects %s as %s', ([filePath, language], { expect }) => {
    expect(detectLanguage(filePath)).toBe(language);
  });

  test.for(['README.md', 'Makefile', 'src/a.ts.orig', '.ts/file'])(
    'has no language for %s',
    (filePath, { expect }) => {
      expect(detectLanguage(filePath)).toBeUndefined();
    },
  );
});
