import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { isTestFile } from './is-test-file.ts';

describe('isTestFile', () => {
  test('recognises test and spec files and __tests__ directories', ({ expect }) => {
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/a.spec.tsx')).toBe(true);
    expect(isTestFile('src/__tests__/a.ts')).toBe(true);
    expect(isTestFile('src/a.ts')).toBe(false);
    expect(isTestFile('src/contest.ts')).toBe(false);
  });
});
