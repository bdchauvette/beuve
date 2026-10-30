import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { normalizePathPrefix } from './normalize-path-prefix.ts';

describe('normalizePathPrefix', () => {
  test('drops ./, empty segments and trailing slashes', ({ expect }) => {
    expect(normalizePathPrefix('src/ui/')).toBe('src/ui');
    expect(normalizePathPrefix('./src//main/./review')).toBe('src/main/review');
    expect(normalizePathPrefix(' README.md ')).toBe('README.md');
  });

  test('refuses paths that are empty, absolute or escape the repository', ({ expect }) => {
    for (const bad of ['', '.', './', '/etc', 'C:/x', 'src/../..', '..', 'a\0b']) {
      expect(normalizePathPrefix(bad)).toBeUndefined();
    }
  });
});
