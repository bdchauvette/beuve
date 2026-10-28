import { describe, expect, it } from 'vitest';

import { parseCitations } from './parse-citations.ts';
import { validateCitations } from './validate-citations.ts';
import type { ValidatedAnswer } from './validate-citations.ts';

const scope = { knownPaths: new Set(['src/a.ts', 'src/b.ts']), worktreePath: '/work/repo' };

function validate(answer: string): ValidatedAnswer {
  return validateCitations(answer, parseCitations(answer), scope);
}

describe('validateCitations', () => {
  it('keeps known paths as canonical markers and dedupes citations', () => {
    expect(validate('See [[src/a.ts:12]], [[./src/a.ts:12-12]] and [[src/b.ts:1-3]].')).toEqual({
      content: 'See [[src/a.ts:12-12]], [[src/a.ts:12-12]] and [[src/b.ts:1-3]].',
      citations: [
        { path: 'src/a.ts', startLine: 12, endLine: 12, side: 'head' },
        { path: 'src/b.ts', startLine: 1, endLine: 3, side: 'head' },
      ],
      dropped: [],
      malformed: 0,
    });
  });

  it('makes absolute paths inside the worktree relative', () => {
    expect(validate('[[/work/repo/src/b.ts:2-3]]')).toMatchObject({
      content: '[[src/b.ts:2-3]]',
      citations: [{ path: 'src/b.ts', startLine: 2, endLine: 3 }],
    });
  });

  it('drops unknown paths, leaving them as code, and reports malformed markers', () => {
    expect(validate('Not [[src/c.ts:4-5]] or [[/etc/passwd:1]]; [[src/a.ts:0]] stays.')).toEqual({
      content: 'Not `src/c.ts:4-5` or `/etc/passwd:1-1`; [[src/a.ts:0]] stays.',
      citations: [],
      dropped: [
        { path: 'src/c.ts', startLine: 4, endLine: 5, reason: 'unknown-path' },
        { path: '/etc/passwd', startLine: 1, endLine: 1, reason: 'unknown-path' },
      ],
      malformed: 1,
    });
  });

  it('leaves an answer without markers unchanged', () => {
    expect(validate('No citations here.')).toEqual({
      content: 'No citations here.',
      citations: [],
      dropped: [],
      malformed: 0,
    });
  });
});
