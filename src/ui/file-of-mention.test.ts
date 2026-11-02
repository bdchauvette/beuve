import { describe } from 'vitest';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import { fileOfMention } from './file-of-mention.ts';
import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { test } from './testing/test.ts';

function mentionOf(overrides: Partial<ChatMentionView>): ChatMentionView {
  return { path: 'src/a.ts', side: 'head', sha: 'a'.repeat(40), ...overrides };
}

function fileOf(
  overrides: Parameters<typeof createDiffFileView>[2],
): ReturnType<typeof createDiffFileView> {
  return createDiffFileView('src/a.ts', [' one', '-two', '+three'], overrides);
}

describe('fileOfMention', () => {
  test('finds a head-side chip’s file by its path', ({ expect }) => {
    const file = fileOf({});
    expect(fileOfMention(mentionOf({}), [file])).toBe(file);
  });

  test('has no file for a head-side chip on a deleted file', ({ expect }) => {
    const file = fileOf({ overrides: { status: 'deleted' } });
    expect(fileOfMention(mentionOf({}), [file])).toBeUndefined();
  });

  test('finds a base-side chip by the file’s old path', ({ expect }) => {
    const file = fileOf({
      overrides: { path: 'src/new.ts', oldPath: 'src/a.ts', status: 'renamed' },
    });
    expect(fileOfMention(mentionOf({ side: 'base' }), [file])).toBe(file);
  });

  test('has no file for a base-side chip on an added file', ({ expect }) => {
    const file = fileOf({ overrides: { status: 'added' } });
    expect(fileOfMention(mentionOf({ side: 'base' }), [file])).toBeUndefined();
  });

  test('has no file the review does not change', ({ expect }) => {
    expect(fileOfMention(mentionOf({ path: 'src/other.ts' }), [fileOf({})])).toBeUndefined();
  });
});
