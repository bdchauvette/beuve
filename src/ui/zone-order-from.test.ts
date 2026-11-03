import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { zoneOrderFrom } from './zone-order-from.ts';

describe('zoneOrderFrom', () => {
  test('a pull request visits Overview, Files, Diff, Review and Chat', ({ expect }) => {
    expect(zoneOrderFrom({ hasSidebar: true, isPullRequest: true })).toStrictEqual([
      'overview',
      'files',
      'diff',
      'ura',
      'chat',
    ]);
  });

  test('a local review skips the Overview', ({ expect }) => {
    expect(zoneOrderFrom({ hasSidebar: true, isPullRequest: false })).toStrictEqual([
      'files',
      'diff',
      'ura',
      'chat',
    ]);
  });

  test('with the sidebar hidden only the diff remains', ({ expect }) => {
    expect(zoneOrderFrom({ hasSidebar: false, isPullRequest: true })).toStrictEqual(['diff']);
  });
});
