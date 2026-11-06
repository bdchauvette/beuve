import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { isGlobMatch } from './is-glob-match.ts';

describe('isGlobMatch', () => {
  test('matches a literal in full, case sensitively', ({ expect }) => {
    expect(isGlobMatch({ pattern: '/work/api', value: '/work/api' })).toBe(true);
    expect(isGlobMatch({ pattern: '/work/api', value: '/work/api/x' })).toBe(false);
    expect(isGlobMatch({ pattern: '/work/api', value: '/Work/api' })).toBe(false);
  });

  test('lets * stand for any run within one directory, and ? for one character', ({ expect }) => {
    expect(isGlobMatch({ pattern: '/work/*', value: '/work/api' })).toBe(true);
    expect(isGlobMatch({ pattern: '/work/*', value: '/work/api/x' })).toBe(false);
    expect(isGlobMatch({ pattern: '/work/a?i', value: '/work/api' })).toBe(true);
    expect(isGlobMatch({ pattern: '/work/a?i', value: '/work/a/i' })).toBe(false);
  });

  test('lets ** cross directories, and match none before a slash', ({ expect }) => {
    expect(isGlobMatch({ pattern: '/work/**', value: '/work/a/b/c' })).toBe(true);
    expect(isGlobMatch({ pattern: '/work/**/api', value: '/work/api' })).toBe(true);
    expect(isGlobMatch({ pattern: '/work/**/api', value: '/work/a/b/api' })).toBe(true);
    expect(isGlobMatch({ pattern: '/work/**/api', value: '/work/a/b/apix' })).toBe(false);
  });

  test('treats everything else as literal text, regular-expression characters included', ({
    expect,
  }) => {
    expect(
      isGlobMatch({ pattern: 'github.com/octo/(a|b)+', value: 'github.com/octo/(a|b)+' }),
    ).toBe(true);
    expect(isGlobMatch({ pattern: 'github.com/octo/(a|b)+', value: 'github.com/octo/a' })).toBe(
      false,
    );
    expect(isGlobMatch({ pattern: 'a.b', value: 'axb' })).toBe(false);
  });

  test('matches remotes the way the config writes them', ({ expect }) => {
    expect(isGlobMatch({ pattern: 'github.com/octo/*', value: 'github.com/octo/handler' })).toBe(
      true,
    );
    expect(isGlobMatch({ pattern: 'github.com/*/handler', value: 'github.com/octo/handler' })).toBe(
      true,
    );
    expect(isGlobMatch({ pattern: 'github.com/octo/*', value: 'ghe.example.com/octo/x' })).toBe(
      false,
    );
  });
});
