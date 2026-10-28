import { describe, expect, it } from 'vitest';

import type { ChatMessage, ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { toChatHistory } from './to-chat-history.ts';

describe('toChatHistory', () => {
  it('keeps questions and completed answers, in order', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001' as ChatMessageId,
      sessionId: '11111111-1111-4111-8111-111111111111' as SessionId,
      headSha: 'c'.repeat(40) as CommitSha,
      citations: [],
      createdAt: '2026-10-28T12:00:00.000Z',
    };
    const messages: ChatMessage[] = [
      { ...base, role: 'user', content: 'q1' },
      { ...base, role: 'assistant', status: 'complete', content: 'a1' },
      { ...base, role: 'system-notice', content: 'Head moved.' },
      { ...base, role: 'user', content: 'q2' },
      { ...base, role: 'assistant', status: 'failed', errorCode: 'timeout', content: '' },
      { ...base, role: 'assistant', status: 'cancelled', content: 'partial' },
      { ...base, role: 'assistant', status: 'streaming', content: 'live' },
    ];
    expect(toChatHistory(messages)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
  });
});
