import { describe } from 'vitest';

import type { ChatMessage, ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { splitAtCompaction } from './split-at-compaction.ts';
import { test } from './testing/test.ts';

function message(id: number, role: 'user' | 'summary'): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}` as ChatMessageId,
    sessionId: '11111111-1111-4111-8111-111111111111' as SessionId,
    headSha: 'c'.repeat(40) as CommitSha,
    role,
    content: `m${String(id)}`,
    citations: [],
    mentions: [],
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}

describe('splitAtCompaction', () => {
  test('compacts nothing without a summary', ({ expect }) => {
    const messages = [message(1, 'user'), message(2, 'user')];
    expect(splitAtCompaction(messages)).toStrictEqual({
      summary: undefined,
      before: [],
      after: messages,
    });
  });

  test('splits at the latest summary, which replaces everything before it', ({ expect }) => {
    const messages = [
      message(1, 'user'),
      message(2, 'summary'),
      message(3, 'user'),
      message(4, 'summary'),
      message(5, 'user'),
    ];
    const split = splitAtCompaction(messages);
    expect(split.summary?.content).toBe('m4');
    expect(split.before.map(({ content }) => content)).toStrictEqual(['m1', 'm2', 'm3']);
    expect(split.after.map(({ content }) => content)).toStrictEqual(['m5']);
  });

  test('has nothing after a summary that is last', ({ expect }) => {
    const split = splitAtCompaction([message(1, 'user'), message(2, 'summary')]);
    expect(split.after).toStrictEqual([]);
    expect(split.before).toHaveLength(1);
  });
});
