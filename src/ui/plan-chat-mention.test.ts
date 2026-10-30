import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { DiffFileView } from '#contract/ipc-contract.ts';

import { planChatMention } from './plan-chat-mention.ts';

function file(): DiffFileView {
  return {
    status: 'renamed',
    path: 'src/new.ts',
    oldPath: 'src/old.ts',
    additions: 2,
    deletions: 1,
    binary: false,
    patch: '',
    hunks: [
      { oldStart: 10, oldCount: 3, newStart: 12, newCount: 4, header: '@@ -10,3 +12,4 @@' },
      { oldStart: 40, oldCount: 2, newStart: 43, newCount: 0, header: '@@ -40,2 +42,0 @@' },
    ],
  };
}

describe('planChatMention', () => {
  test('takes a head-side selection, in order', ({ expect }) => {
    expect(
      planChatMention(file(), file().hunks[0], { start: 30, end: 27, side: 'additions' }),
    ).toStrictEqual({ path: 'src/new.ts', side: 'head', startLine: 27, endLine: 30 });
  });

  test('names a selection on the base side with the base path', ({ expect }) => {
    expect(
      planChatMention(file(), undefined, {
        start: 11,
        end: 12,
        side: 'deletions',
        endSide: 'deletions',
      }),
    ).toStrictEqual({ path: 'src/old.ts', side: 'base', startLine: 11, endLine: 12 });
    expect(
      planChatMention(file(), undefined, {
        start: 11,
        end: 14,
        side: 'deletions',
        endSide: 'additions',
      }),
    ).toMatchObject({ side: 'head' });
  });

  test('falls back to the focused hunk, a pure deletion on its base lines, then the whole file', ({
    expect,
  }) => {
    expect(planChatMention(file(), file().hunks[0], undefined)).toStrictEqual({
      path: 'src/new.ts',
      side: 'head',
      startLine: 12,
      endLine: 15,
    });
    expect(planChatMention(file(), file().hunks[1], undefined)).toStrictEqual({
      path: 'src/old.ts',
      side: 'base',
      startLine: 40,
      endLine: 41,
    });
    expect(planChatMention(file(), undefined, undefined)).toStrictEqual({
      path: 'src/new.ts',
      side: 'head',
    });
    expect(planChatMention({ ...file(), status: 'deleted' }, undefined, undefined)).toStrictEqual({
      path: 'src/old.ts',
      side: 'base',
    });
  });
});
