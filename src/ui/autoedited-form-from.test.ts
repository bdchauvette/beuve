import { describe } from 'vitest';

import { autoeditedFormFrom } from './autoedited-form-from.ts';
import type { AutoeditForm } from './autoedited-form-from.ts';
import { test } from './testing/test.ts';

function before(): AutoeditForm {
  return {
    body: 'rename?',
    fields: [
      {
        key: 'new-1',
        id: 'stored-1',
        headSha: 'a'.repeat(40),
        path: 'src/a.ts',
        startLine: 3,
        endLine: 4,
        replacement: 'retries',
        outdated: 'the lines changed',
      },
      {
        key: 'new-2',
        headSha: 'a'.repeat(40),
        path: 'src/b.ts',
        startLine: 1,
        endLine: 1,
        replacement: 'b',
      },
    ],
  };
}

function keys(): () => string {
  let count = 0;
  return (): string => {
    count += 1;
    return `autoedit-${String(count)}`;
  };
}

describe('autoeditedFormFrom', () => {
  test('replaces revised fields under fresh keys, keeps the rest and adds new ones at the end', ({
    expect,
  }) => {
    const form = before();
    const after = autoeditedFormFrom(
      form,
      {
        body: 'Rename `retries` to `retryBudget`.',
        suggestions: [
          { path: 'src/a.ts', startLine: 9, endLine: 8, replacement: 'const retryBudget = 3;' },
          { key: 'new-1', path: 'src/a.ts', startLine: 3, endLine: 4, replacement: 'retryBudget' },
        ],
      },
      { headSha: 'b'.repeat(40), newKey: keys() },
    );
    expect(after).toStrictEqual({
      body: 'Rename `retries` to `retryBudget`.',
      fields: [
        {
          key: 'autoedit-1',
          id: 'stored-1',
          headSha: 'a'.repeat(40),
          path: 'src/a.ts',
          startLine: 3,
          endLine: 4,
          replacement: 'retryBudget',
          outdated: 'the lines changed',
        },
        form.fields[1],
        {
          key: 'autoedit-2',
          headSha: 'b'.repeat(40),
          path: 'src/a.ts',
          startLine: 9,
          endLine: 8,
          replacement: 'const retryBudget = 3;',
        },
      ],
    });
    expect(form).toStrictEqual(before());
  });

  test('undoing is the form before: the revised fields come back and the added ones go', ({
    expect,
  }) => {
    const form = before();
    const after = autoeditedFormFrom(
      form,
      {
        body: 'Longer.',
        suggestions: [
          { key: 'new-2', path: 'src/b.ts', startLine: 1, endLine: 1, replacement: 'B' },
          { path: 'src/c.ts', startLine: 2, endLine: 2, replacement: 'c' },
        ],
      },
      { headSha: 'a'.repeat(40), newKey: keys() },
    );
    const afterKeys = after.fields.map((field) => field.key);
    const beforeKeys = form.fields.map((field) => field.key);
    expect(afterKeys).toStrictEqual(['new-1', 'autoedit-1', 'autoedit-2']);
    expect(beforeKeys).toStrictEqual(['new-1', 'new-2']);
    expect(form).toStrictEqual(before());
  });

  test('an answer without suggestions only changes the body', ({ expect }) => {
    const form = before();
    expect(
      autoeditedFormFrom(
        form,
        { body: 'Text.', suggestions: [] },
        {
          headSha: 'a'.repeat(40),
          newKey: keys(),
        },
      ),
    ).toStrictEqual({ body: 'Text.', fields: form.fields });
  });
});
