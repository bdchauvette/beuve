import { describe } from 'vitest';

import { parseRevisionName } from './parse-revision-name.ts';
import { test } from './testing/test.ts';

describe('parseRevisionName', () => {
  test.for([
    'main',
    'HEAD',
    'HEAD~2',
    'HEAD^2~1',
    'refs/heads/feature/x',
    'v1.2.3',
    '6f81813',
    'a+b',
    'user/ü',
  ])('accepts %j', (text, { expect }) => {
    expect(parseRevisionName(text)).toBe(text);
  });

  test.for([
    '',
    '-n',
    '^HEAD',
    'HEAD@{1}',
    'main@{yesterday}',
    'HEAD:path',
    'HEAD^{tree}',
    'a..b',
    'a b',
    'new\nline',
    'glob*',
    'back\\slash',
    'x'.repeat(2000),
  ])('refuses %j', (text, { expect }) => {
    expect(parseRevisionName(text)).toBeUndefined();
  });
});
