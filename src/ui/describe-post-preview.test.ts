import { describe } from 'vitest';

import { createGithubPreview } from './testing/create-github-preview.ts';
import { test } from './testing/test.ts';

import { describePostPreview } from './describe-post-preview.ts';

function counts(): string {
  return `1 inline comment, as Approve, on ${'a'.repeat(12)}.`;
}

describe('describePostPreview', () => {
  test('says what a compiled preview sends', ({ expect }) => {
    const preview = createGithubPreview({ sessionId: 's1', headSha: 'a'.repeat(40) });
    expect(describePostPreview({ kind: 'ready', preview })).toBe(counts());
  });

  test('keeps the last preview while a fresh one compiles', ({ expect }) => {
    const last = createGithubPreview({ sessionId: 's1', headSha: 'a'.repeat(40) });
    expect(describePostPreview({ kind: 'loading', last })).toBe(counts());
    expect(describePostPreview({ kind: 'loading', last: undefined })).toBe('Compiling the review…');
  });

  test('says why there is no preview', ({ expect }) => {
    expect(describePostPreview({ kind: 'failed', text: 'git failed' })).toBe(
      "Couldn't compile the review: git failed",
    );
    expect(describePostPreview({ kind: 'none' })).toBe('Not compiled yet.');
  });
});
