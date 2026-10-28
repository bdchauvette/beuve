import type { CommitSha, SessionId } from '../agent-insight.ts';
import type { ReviewFile, ReviewInput } from '../review-input.ts';

/**
 * A full review of a worktree at `/work/repo` with two files: `src/a.ts` (modified, one hunk on head
 * lines 10–14) and `src/b.ts` (added, lines 1–3). Head is `c…c`, base `b…b`.
 */
export function createReviewInput(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    sessionId: testSessionId,
    scope: { kind: 'full', baseSha: testBaseSha, headSha: testHeadSha },
    worktreePath: '/work/repo',
    files: [modifiedFile, addedFile],
    ...overrides,
  };
}

const testSessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const testBaseSha = 'b'.repeat(40) as CommitSha;
const testHeadSha = 'c'.repeat(40) as CommitSha;

/** `src/a.ts`: one hunk covering head lines 10–14. */
const modifiedFile: ReviewFile = {
  path: 'src/a.ts',
  status: 'modified',
  binary: false,
  patch: [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,4 +10,5 @@ export function parse(input: string) {',
    '   const parts = input.split(",");',
    '-  return parts[0];',
    '+  const first = parts[0];',
    '+  return first.trim();',
    '   // end',
    ' }',
    '',
  ].join('\n'),
};

/** `src/b.ts`: added, head lines 1–3. */
const addedFile: ReviewFile = {
  path: 'src/b.ts',
  status: 'added',
  binary: false,
  patch: [
    'diff --git a/src/b.ts b/src/b.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/b.ts',
    '@@ -0,0 +1,3 @@',
    '+export function b(): number {',
    '+  return 1;',
    '+}',
    '',
  ].join('\n'),
};
