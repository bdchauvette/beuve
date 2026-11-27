import { describe } from 'vitest';

import type { UraSuggestionDraftView } from '#contract/ipc-contract.ts';
import { parseUnifiedDiff } from '#internal/git/parse-unified-diff.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../testing/test.ts';
import { planEditSuggestions } from './plan-edit-suggestions.ts';
import type { EditPlan, EditPlanInput, NoteAtHead } from './plan-edit-suggestions.ts';

describe('planEditSuggestions', () => {
  test('every region of a file becomes a suggestion of one new note, changed by the pull request or not', ({
    expect,
  }) => {
    const plan = planEditSuggestions(
      input(['@@ -0,0 +1,1 @@', '+// header', '@@ -3,2 +4,2 @@', '-three', '-four', '+3', '+4']),
    );
    expect(plan.edits).toMatchObject([
      {
        action: 'create',
        kind: 'suggestions',
        target: 'suggestions:a.ts',
        severity: 'suggestion',
        title: 'Suggested changes to `a.ts`',
        anchor: { kind: 'lines', path: 'a.ts', startLine: 1, endLine: 1 },
        diff: '',
      },
    ]);
    expect(suggestionsOf(plan)).toStrictEqual([
      { path: 'a.ts', startLine: 1, endLine: 0, replacement: '// header' },
      { path: 'a.ts', startLine: 3, endLine: 4, replacement: '3\n4' },
    ]);
    expect(plan.edits[0]?.suggestions[1]?.diff).toBe(
      '--- a/a.ts\n+++ b/a.ts\n@@ -1,5 +1,5 @@\n one\n two\n-three\n-four\n+3\n+4\n five\n',
    );
  });

  test('an insertion is a suggestion of its own lines before the next one', ({ expect }) => {
    const plan = planEditSuggestions(input(['@@ -2,0 +3,1 @@', '+inserted']));
    expect(suggestionsOf(plan)).toStrictEqual([
      { path: 'a.ts', startLine: 3, endLine: 2, replacement: 'inserted' },
    ]);
    expect(plan.edits[0]?.anchor).toStrictEqual({
      kind: 'lines',
      path: 'a.ts',
      startLine: 2,
      endLine: 2,
    });
  });

  test('a line emptied, or one empty line inserted, takes the line after it along, else the one before', ({
    expect,
  }) => {
    expect(planned(['@@ -2 +2 @@', '-two', '+'])).toStrictEqual([
      { path: 'a.ts', startLine: 2, endLine: 3, replacement: '\nthree' },
    ]);
    expect(planned(['@@ -5 +5 @@', '-five', '+'])).toStrictEqual([
      { path: 'a.ts', startLine: 4, endLine: 5, replacement: 'four\n' },
    ]);
    expect(planned(['@@ -2,0 +3 @@', '+'])).toStrictEqual([
      { path: 'a.ts', startLine: 3, endLine: 3, replacement: '\nthree' },
    ]);
    expect(planned(['@@ -5,0 +6 @@', '+'])).toStrictEqual([
      { path: 'a.ts', startLine: 5, endLine: 5, replacement: 'five\n' },
    ]);
  });

  test('regions a staged note covers attach to it, each its own suggestion; the rest group', ({
    expect,
  }) => {
    const diff = ['@@ -1 +1 @@', '-one', '+ONE', '@@ -3 +3 @@', '-three', '+THREE'];
    const diffs = [...diff, '@@ -5 +5 @@', '-five', '+FIVE'];
    const plan = planEditSuggestions({
      ...input(diffs),
      notes: [note({ suggestions: [] })],
    });
    expect(
      plan.edits.map((edit) => {
        return [edit.action, edit.target, edit.itemId, edit.title];
      }),
    ).toStrictEqual([
      ['attach', 'note:n1', 'n1', '2 suggested changes for “Retry”'],
      ['create', 'suggestions:a.ts', undefined, 'Suggested changes to `a.ts`'],
    ]);
    expect(plan.edits[0]?.anchor).toStrictEqual({
      kind: 'lines',
      path: 'a.ts',
      startLine: 1,
      endLine: 3,
    });
    expect(
      plan.edits.map((edit) => {
        return edit.suggestions.map(({ suggestion }) => suggestion.replacement);
      }),
    ).toStrictEqual([['ONE', 'THREE'], ['FIVE']]);
  });

  test('a note with suggestions of its own keeps them, and its regions group instead', ({
    expect,
  }) => {
    const own = { id: 's1', path: 'a.ts', startLine: 2, endLine: 2, replacement: 'theirs' };
    const plan = planEditSuggestions({
      ...input(['@@ -1 +1 @@', '-one', '+ONE']),
      notes: [note({ suggestions: [own] })],
    });
    expect(
      plan.edits.map((edit) => {
        return [edit.action, edit.target];
      }),
    ).toStrictEqual([['create', 'suggestions:a.ts']]);
  });

  test('an earlier harvest makes the same item unchanged and a different one an update, keeping ids', ({
    expect,
  }) => {
    const first = planEditSuggestions(input(['@@ -2 +2 @@', '-two', '+TWO']));
    const [edit] = first.edits;
    const harvested = new Map([
      [edit?.target ?? '', { itemId: 'i1', fingerprint: edit?.fingerprint ?? '' }],
    ]);
    const group = note({
      itemId: 'i1',
      startLine: 2,
      endLine: 2,
      suggestions: [{ id: 's1', path: 'a.ts', startLine: 2, endLine: 2, replacement: 'TWO' }],
    });
    const again = planEditSuggestions({
      ...input(['@@ -2 +2 @@', '-two', '+TWO']),
      notes: [group],
      harvested,
    });
    expect(again.edits).toMatchObject([{ action: 'unchanged', itemId: 'i1' }]);
    expect(again.digest).not.toBe(first.digest);
    const changed = planEditSuggestions({
      ...input(['@@ -2 +2 @@', '-two', '+Two']),
      notes: [group],
      harvested,
    });
    expect(changed.edits).toMatchObject([{ action: 'update', itemId: 'i1' }]);
    expect(suggestionsOf(changed)).toStrictEqual([
      { id: 's1', path: 'a.ts', startLine: 2, endLine: 2, replacement: 'Two' },
    ]);
  });

  test('a region that changes the final newline is a note with a diff', ({ expect }) => {
    const plan = planEditSuggestions({
      ...input(['@@ -5 +5 @@', '-five', '\\ No newline at end of file', '+five']),
      headTexts: new Map([['a.ts', 'one\ntwo\nthree\nfour\nfive']]),
    });
    expect(plan.edits).toMatchObject([
      {
        kind: 'note',
        target: 'lines:a.ts:5-5',
        title: 'Edit to line 5 (its final newline changes)',
        suggestions: [],
      },
    ]);
    expect(plan.edits[0]?.body).toContain('```diff\n--- a/a.ts');
  });

  test('a file with more than 500 regions splits into notes of at most 500', ({ expect }) => {
    const plan = planEditSuggestions(many(1201));
    expect(
      plan.edits.map((edit) => {
        return [edit.target, edit.title, edit.suggestions.length, edit.anchor];
      }),
    ).toStrictEqual([
      [
        'suggestions:b.ts',
        'Suggested changes to `b.ts` (1 of 3)',
        500,
        { kind: 'lines', path: 'b.ts', startLine: 1, endLine: 1 },
      ],
      [
        'suggestions:b.ts#2',
        'Suggested changes to `b.ts` (2 of 3)',
        500,
        { kind: 'lines', path: 'b.ts', startLine: 1001, endLine: 1001 },
      ],
      [
        'suggestions:b.ts#3',
        'Suggested changes to `b.ts` (3 of 3)',
        201,
        { kind: 'lines', path: 'b.ts', startLine: 2001, endLine: 2001 },
      ],
    ]);
  });

  test('a staged note takes at most 500 regions; the rest go to the file’s new note', ({
    expect,
  }) => {
    const plan = planEditSuggestions({
      ...many(502),
      notes: [note({ path: 'b.ts', startLine: 1, endLine: 1003 })],
    });
    expect(
      plan.edits.map((edit) => {
        return [edit.action, edit.target, edit.suggestions.length];
      }),
    ).toStrictEqual([
      ['attach', 'note:n1', 500],
      ['create', 'suggestions:b.ts', 2],
    ]);
  });

  test('a region replaced with over 64 KiB is a note with a diff', ({ expect }) => {
    const long = 'x'.repeat(64 * 1024 + 1);
    const plan = planEditSuggestions(
      input(['@@ -2 +2 @@', '-two', `+${long}`, '@@ -4 +4 @@', '-four', '+FOUR']),
    );
    expect(
      plan.edits.map((edit) => {
        return [edit.kind, edit.target, edit.title];
      }),
    ).toStrictEqual([
      ['note', 'lines:a.ts:2-2', 'Edit to line 2 (too large for a suggestion)'],
      ['suggestions', 'suggestions:a.ts', 'Suggested changes to `a.ts`'],
    ]);
    expect(plan.edits[0]?.diff).toContain(`+${long}\n`);
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
    const plan = planEditSuggestions({ ...input([]), edits: files });
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

/** `a.ts` (`one` … `five`) edited by `hunk`. */
function input(hunk: readonly string[]): EditPlanInput {
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
    notes: [],
    harvested: new Map(),
    branch: 'review/pr-1',
  };
}

/** Every suggestion the plan stages, in order. */
function suggestionsOf(plan: EditPlan): UraSuggestionDraftView[] {
  return plan.edits.flatMap((edit) => {
    return edit.suggestions.map(({ suggestion }) => suggestion);
  });
}

/** Staged note `n1`, “Retry”, on `a.ts` lines 1–3, with `changes` applied. */
function note(changes: Partial<NoteAtHead>): NoteAtHead {
  return {
    itemId: 'n1',
    path: 'a.ts',
    startLine: 1,
    endLine: 3,
    title: 'Retry',
    suggestions: [],
    ...changes,
  };
}

/** The suggestions planned for `a.ts` edited by `hunk`. */
function planned(hunk: readonly string[]): UraSuggestionDraftView[] {
  return suggestionsOf(planEditSuggestions(input(hunk)));
}

/** `b.ts` of 2 × `count` lines, every other line from line 1 edited: `count` regions. */
function many(count: number): EditPlanInput {
  const hunks = Array.from({ length: count }, (_, index) => {
    const line = String(index * 2 + 1);
    return [`@@ -${line} +${line} @@`, `-${line}`, `+edited ${line}`];
  }).flat();
  const text = [
    'diff --git a/b.ts b/b.ts',
    'index 1111111..2222222 100644',
    '--- a/b.ts',
    '+++ b/b.ts',
    ...hunks,
    '',
  ].join('\n');
  const lines = Array.from({ length: count * 2 }, (_, index) => `${String(index + 1)}\n`);
  return {
    ...input([]),
    edits: okValueFrom(parseUnifiedDiff(text)),
    headTexts: new Map([['b.ts', lines.join('')]]),
  };
}
