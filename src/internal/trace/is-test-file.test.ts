import { describe, expect, it } from 'vitest';

import { isTestFile } from './is-test-file.ts';

describe('isTestFile', () => {
  it('recognises test and spec files and __tests__ directories', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/a.spec.tsx')).toBe(true);
    expect(isTestFile('src/__tests__/a.ts')).toBe(true);
    expect(isTestFile('src/a.ts')).toBe(false);
    expect(isTestFile('src/contest.ts')).toBe(false);
  });
});
