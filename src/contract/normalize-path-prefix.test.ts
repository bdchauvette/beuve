import { describe, expect, it } from 'vitest';

import { normalizePathPrefix } from './normalize-path-prefix.ts';

describe('normalizePathPrefix', () => {
  it('drops ./, empty segments and trailing slashes', () => {
    expect(normalizePathPrefix('src/ui/')).toBe('src/ui');
    expect(normalizePathPrefix('./src//main/./review')).toBe('src/main/review');
    expect(normalizePathPrefix(' README.md ')).toBe('README.md');
  });

  it('refuses paths that are empty, absolute or escape the repository', () => {
    for (const bad of ['', '.', './', '/etc', 'C:/x', 'src/../..', '..', 'a\0b']) {
      expect(normalizePathPrefix(bad)).toBeUndefined();
    }
  });
});
