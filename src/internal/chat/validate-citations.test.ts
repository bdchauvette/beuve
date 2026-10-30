import { describe } from 'vitest';

import { parseCitations } from './parse-citations.ts';
import { validateCitations } from './validate-citations.ts';
import type { CitationScope, ValidatedAnswer } from './validate-citations.ts';
import { test } from './testing/test.ts';

function validate(answer: string): ValidatedAnswer {
  return validateCitations(answer, parseCitations(answer), scope());
}

describe('validateCitations', () => {
  test('keeps known paths as canonical markers and dedupes citations', ({ expect }) => {
    expect(
      validate('See [[src/a.ts:12]], [[./src/a.ts:12-12]] and [[src/b.ts:1-3]].'),
    ).toStrictEqual({
      content: 'See [[src/a.ts:12-12]], [[src/a.ts:12-12]] and [[src/b.ts:1-3]].',
      citations: [
        { path: 'src/a.ts', startLine: 12, endLine: 12, side: 'head' },
        { path: 'src/b.ts', startLine: 1, endLine: 3, side: 'head' },
      ],
      dropped: [],
      malformed: 0,
    });
  });

  test('makes absolute paths inside the worktree relative', ({ expect }) => {
    expect(validate('[[/work/repo/src/b.ts:2-3]]')).toMatchObject({
      content: '[[src/b.ts:2-3]]',
      citations: [{ path: 'src/b.ts', startLine: 2, endLine: 3 }],
    });
  });

  test('drops unknown paths, leaving them as code, and reports malformed markers', ({ expect }) => {
    expect(
      validate('Not [[src/c.ts:4-5]] or [[/etc/passwd:1]]; [[src/a.ts:0]] stays.'),
    ).toStrictEqual({
      content: 'Not `src/c.ts:4-5` or `/etc/passwd:1-1`; [[src/a.ts:0]] stays.',
      citations: [],
      dropped: [
        { path: 'src/c.ts', startLine: 4, endLine: 5, reason: 'unknown-path' },
        { path: '/etc/passwd', startLine: 1, endLine: 1, reason: 'unknown-path' },
      ],
      malformed: 1,
    });
  });

  test('leaves an answer without markers unchanged', ({ expect }) => {
    expect(validate('No citations here.')).toStrictEqual({
      content: 'No citations here.',
      citations: [],
      dropped: [],
      malformed: 0,
    });
  });
});

function scope(): CitationScope {
  return { knownPaths: new Set(['src/a.ts', 'src/b.ts']), worktreePath: '/work/repo' };
}
