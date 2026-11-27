import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { renameLeftOutLines } from './rename-left-out-lines.ts';

describe('renameLeftOutLines', () => {
  test('says nothing when nothing was left out', ({ expect }) => {
    expect(
      renameLeftOutLines({
        resourceOperations: 0,
        outsideCheckout: 0,
        untracked: 0,
        malformed: 0,
        unusable: [],
      }),
    ).toStrictEqual([]);
  });

  test('counts each kind, and names unusable files with their paths revealed', ({ expect }) => {
    expect(
      renameLeftOutLines({
        resourceOperations: 1,
        outsideCheckout: 2,
        untracked: 1,
        malformed: 3,
        unusable: [{ path: 'src/\u{202E}b.ts', reason: 'the edits overlap' }],
      }),
    ).toStrictEqual([
      '1 file operation (create, rename or delete a file) left out.',
      '2 files outside the checkout left out.',
      '1 file the head doesn’t track left out.',
      '3 edits beuve can’t read left out.',
      'src/⟨U+202E⟩b.ts left out: the edits overlap.',
    ]);
  });
});
