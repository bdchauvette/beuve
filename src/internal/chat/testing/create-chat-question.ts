import type { CommitSha, SessionId } from '../chat-message.ts';
import type { ChatFile, ChatQuestion } from '../chat-question.ts';

/**
 * A question about a worktree at `/work/repo` with two changed files: `src/a.ts` (modified, one
 * hunk on head lines 10–14) and `src/b.ts` (added, lines 1–3). Head is `c…c`, base `b…b`.
 */
export function createChatQuestion(overrides: Partial<ChatQuestion> = {}): ChatQuestion {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111' as SessionId,
    baseSha: 'b'.repeat(40) as CommitSha,
    headSha: 'c'.repeat(40) as CommitSha,
    worktreePath: '/work/repo',
    question: 'Why does parse trim the first part?',
    files: [modifiedFile, addedFile],
    ...overrides,
  };
}

const modifiedFile: ChatFile = {
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

const addedFile: ChatFile = {
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
