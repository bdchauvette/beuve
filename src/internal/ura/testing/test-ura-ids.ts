import type { CommitSha, SessionId, UraItemId } from '../ura-item.ts';

/** Fixed ids for tests. `itemId(n)` matches what `fixedUraDeps` hands out n-th. */
export const testUraIds = {
  sessionId: '11111111-1111-4111-8111-111111111111' as SessionId,
  otherSessionId: '44444444-4444-4444-8444-444444444444' as SessionId,
  headSha: 'a'.repeat(40) as CommitSha,
  laterHeadSha: 'b'.repeat(40) as CommitSha,
  baseSha: 'c'.repeat(40) as CommitSha,
  messageId: '33333333-3333-4333-8333-333333333333',
  itemId: (n: number): UraItemId =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as UraItemId,
} as const;
