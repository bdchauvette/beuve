import { describe } from 'vitest';

import { parseUnifiedDiff } from '#internal/git/parse-unified-diff.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../testing/test.ts';
import { planEditSuggestions } from './plan-edit-suggestions.ts';
import type { EditPlanInput } from './plan-edit-suggestions.ts';

describe('planEditSuggestions', () => {
  test('an insertion below a changed line becomes a suggestion replacing that line', ({
    expect,
  }) => {
    const plan = planEditSuggestions(input(['@@ -2,0 +3,1 @@', '+inserted'], { changed: [2] }));
    expect(plan.edits).toMatchObject([
      {
        action: 'create',
        kind: 'suggestion',
        anchor: { kind: 'lines', path: 'a.ts', startLine: 2, endLine: 2 },
      },
    ]);
    expect(plan.edits[0]?.patch).toBe(
      '--- a/a.ts\n+++ b/a.ts\n@@ -1,5 +1,6 @@\n one\n-two\n+two\n+inserted\n three\n four\n five\n',
    );
  });

  test('an insertion at the top replaces line 1; an edit spanning unchanged lines is a note', ({
    expect,
  }) => {
    const plan = planEditSuggestions(
      input(['@@ -0,0 +1,1 @@', '+// header', '@@ -3,2 +4,2 @@', '-three', '-four', '+3', '+4'], {
        changed: [1, 3],
      }),
    );
    expect(
      plan.edits.map((edit) => {
        return [edit.target, edit.kind];
      }),
    ).toStrictEqual([
      ['lines:a.ts:1-1', 'suggestion'],
      ['lines:a.ts:3-4', 'note'],
    ]);
    expect(plan.edits[1]?.body).toContain('```diff\n--- a/a.ts');
  });

  test('regions inside one staged note become one patch over its lines; a foreign patch is kept', ({
    expect,
  }) => {
    const diff = ['@@ -1 +1 @@', '-one', '+ONE', '@@ -3 +3 @@', '-three', '+THREE'];
    const attached = planEditSuggestions({
      ...input(diff, { changed: [1, 2, 3] }),
      notes: [{ itemId: 'n1', path: 'a.ts', startLine: 1, endLine: 3, suggestion: undefined }],
    });
    expect(attached.edits).toMatchObject([
      { action: 'attach', itemId: 'n1', anchor: { startLine: 1, endLine: 3 } },
    ]);
    expect(attached.edits[0]?.patch).toContain('-one\n-two\n-three\n+ONE\n+two\n+THREE\n');
    const kept = planEditSuggestions({
      ...input(diff, { changed: [1, 2, 3] }),
      notes: [{ itemId: 'n1', path: 'a.ts', startLine: 1, endLine: 3, suggestion: 'theirs' }],
    });
    expect(
      kept.edits.map((edit) => {
        return [edit.action, edit.target];
      }),
    ).toStrictEqual([
      ['create', 'lines:a.ts:1-1'],
      ['create', 'lines:a.ts:3-3'],
    ]);
  });

  test('an earlier harvest makes the same edit unchanged and a different one an update', ({
    expect,
  }) => {
    const first = planEditSuggestions(input(['@@ -2 +2 @@', '-two', '+TWO'], { changed: [2] }));
    const [edit] = first.edits;
    const harvested = new Map([
      [edit?.target ?? '', { itemId: 'i1', fingerprint: edit?.fingerprint ?? '' }],
    ]);
    const again = planEditSuggestions({
      ...input(['@@ -2 +2 @@', '-two', '+TWO'], { changed: [2] }),
      harvested,
    });
    expect(again.edits).toMatchObject([{ action: 'unchanged', itemId: 'i1' }]);
    expect(again.digest).not.toBe(first.digest);
    const changed = planEditSuggestions({
      ...input(['@@ -2 +2 @@', '-two', '+Two'], { changed: [2] }),
      harvested,
    });
    expect(changed.edits).toMatchObject([{ action: 'update', itemId: 'i1' }]);
  });

  test('new, deleted, renamed and binary files become notes', ({ expect }) => {
    const files = okValueFrom(
      parseUnifiedDiff(
        [
          'diff --git a/new.ts b/new.ts',
          'new file mode 100644',
          'index 0000000..1111111',
          '--- /dev/null',
          '+++ b/new.ts',
          '@@ -0,0 +1 @@',
          '+n',
          'diff --git a/gone.ts b/gone.ts',
          'deleted file mode 100644',
          'index 2222222..0000000',
          '--- a/gone.ts',
          '+++ /dev/null',
          '@@ -1 +0,0 @@',
          '-g',
          'diff --git a/old.ts b/moved.ts',
          'similarity index 100%',
          'rename from old.ts',
          'rename to moved.ts',
          'diff --git a/img.png b/img.png',
          'index 3333333..4444444 100644',
          'Binary files a/img.png and b/img.png differ',
          '',
        ].join('\n'),
      ),
    );
    const plan = planEditSuggestions({ ...input([], { changed: [] }), edits: files });
    expect(
      plan.edits.map((edit) => {
        return [edit.kind, edit.anchor, edit.title];
      }),
    ).toStrictEqual([
      ['note', { kind: 'change' }, 'New file `new.ts`'],
      ['note', { kind: 'file', path: 'gone.ts' }, 'Delete `gone.ts`'],
      ['note', { kind: 'file', path: 'old.ts' }, 'Rename `old.ts` to `moved.ts`'],
      ['note', { kind: 'file', path: 'img.png' }, 'Change `img.png` (binary)'],
    ]);
  });
});

/** What a test changes about the default input. */
interface Edits {
  readonly changed: readonly number[];
}

/** `a.ts` (`one` … `five`) edited by `hunk`, with these head lines changed by the pull request. */
function input(hunk: readonly string[], { changed }: Edits): EditPlanInput {
  const text = [
    'diff --git a/a.ts b/a.ts',
    'index 1111111..2222222 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    ...hunk,
    '',
  ].join('\n');
  return {
    edits: okValueFrom(parseUnifiedDiff(text)),
    headTexts: new Map([['a.ts', 'one\ntwo\nthree\nfour\nfive\n']]),
    changedLines: new Map([['a.ts', new Set(changed)]]),
    notes: [],
    harvested: new Map(),
    branch: 'review/pr-1',
  };
}
