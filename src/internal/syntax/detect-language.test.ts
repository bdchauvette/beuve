import { describe, expect, it } from 'vitest';

import { detectLanguage } from './detect-language.ts';

describe('detectLanguage', () => {
  it.each([
    ['src/a.ts', 'typescript'],
    ['types/env.d.ts', 'typescript'],
    ['x/y.MTS', 'typescript'],
    ['view.tsx', 'tsx'],
    ['lib/index.js', 'javascript'],
    ['app.jsx', 'javascript'],
    ['config.cjs', 'javascript'],
  ])('detects %s as %s', (filePath, language) => {
    expect(detectLanguage(filePath)).toBe(language);
  });

  it.each(['README.md', 'Makefile', 'src/a.ts.orig', '.ts/file'])(
    'has no language for %s',
    (filePath) => {
      expect(detectLanguage(filePath)).toBeUndefined();
    },
  );
});
