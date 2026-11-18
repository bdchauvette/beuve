import { FileDiff, parseDiffFromFile, processFile, setLanguageOverride } from '@pierre/diffs';
import type { FileDiffMetadata } from '@pierre/diffs';
import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { editableDiffFrom } from './editable-diff-from.ts';
import { definedValue } from './testing/defined-value.ts';
import { errorFrom } from '#x/error/error-from.ts';

function head(): string {
  return 'one\ntwo\n';
}

function addedPatch(): string {
  return [
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,2 @@',
    '+one',
    '+two',
    '',
  ].join('\n');
}

function modifiedPatch(): string {
  return [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,2 @@',
    ' one',
    '-two',
    '+TWO',
    '',
  ].join('\n');
}

/** The card's parse of `patch` (`metadataFrom` in `beuve-file-card.ts`): no files, so partial. */
function shownFrom(patch: string): FileDiffMetadata {
  return definedValue(processFile(patch, { cacheKey: 'key', isGitDiff: true }));
}

/** What `FileDiff.prepareForEditing` makes of `fileDiff`: done, or the message it throws. */
async function preparedFrom(fileDiff: FileDiffMetadata): Promise<string> {
  const diff = new FileDiff();
  diff.fileDiff = fileDiff;
  try {
    await diff.prepareForEditing();
    return 'prepared';
  } catch (error: unknown) {
    return errorFrom(error).message;
  }
}

describe('editableDiffFrom', () => {
  test('the library cannot hydrate the card’s diff of an added file', async ({ expect }) => {
    const shown = shownFrom(addedPatch());
    await expect(preparedFrom(shown)).resolves.toBe(
      'FileDiff: this partial diff cannot be hydrated; provide a complete diff to edit',
    );
  });

  test('completes an added file from its head, so the editor can attach', async ({ expect }) => {
    const shown = shownFrom(addedPatch());
    const editable = editableDiffFrom({
      library: { processFile },
      shown,
      patch: addedPatch(),
      head: head(),
    });
    await expect(preparedFrom(editable)).resolves.toBe('prepared');
    const parsed = parseDiffFromFile(
      { name: 'src/new.ts', contents: '' },
      { name: 'src/new.ts', contents: head() },
    );
    expect({
      type: editable.type,
      isPartial: editable.isPartial,
      additionLines: editable.additionLines,
      deletionLines: editable.deletionLines,
      hunks: editable.hunks,
    }).toStrictEqual({
      type: 'new',
      isPartial: false,
      additionLines: ['one\n', 'two\n'],
      deletionLines: [],
      hunks: parsed.hunks,
    });
    expect(editable.cacheKey).not.toBe(shown.cacheKey);
    expect(shown.isPartial).toBe(true);
  });

  test('keeps the language the card chose', ({ expect }) => {
    const shown = setLanguageOverride(shownFrom(addedPatch()), 'text');
    const editable = editableDiffFrom({
      library: { processFile },
      shown,
      patch: addedPatch(),
      head: head(),
    });
    expect(editable.lang).toBe('text');
  });

  test('leaves a diff the library hydrates itself as it is', ({ expect }) => {
    const shown = shownFrom(modifiedPatch());
    expect(
      editableDiffFrom({
        library: { processFile },
        shown,
        patch: modifiedPatch(),
        head: 'one\nTWO\n',
      }),
    ).toBe(shown);
  });
});
