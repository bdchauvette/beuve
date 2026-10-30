import { describe, expect, it } from 'vitest';

import type { ChatMessage, ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { toChatHistory } from './to-chat-history.ts';

const base = {
  id: '00000000-0000-4000-8000-000000000001' as ChatMessageId,
  sessionId: '11111111-1111-4111-8111-111111111111' as SessionId,
  headSha: 'c'.repeat(40) as CommitSha,
  citations: [],
  mentions: [],
  createdAt: '2026-10-28T12:00:00.000Z',
};

describe('toChatHistory', () => {
  it('keeps questions and completed answers, in order', () => {
    const messages: ChatMessage[] = [
      { ...base, role: 'user', content: 'q1' },
      { ...base, role: 'assistant', kind: 'answer', status: 'complete', content: 'a1' },
      { ...base, role: 'system-notice', content: 'Head moved.' },
      { ...base, role: 'user', content: 'q2' },
      {
        ...base,
        role: 'assistant',
        kind: 'answer',
        status: 'failed',
        errorCode: 'timeout',
        content: '',
      },
      { ...base, role: 'assistant', kind: 'answer', status: 'cancelled', content: 'partial' },
      { ...base, role: 'assistant', kind: 'answer', status: 'streaming', content: 'live' },
    ];
    expect(toChatHistory(messages)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  it('keeps a question’s mentions and only the turns after the latest summary', () => {
    const mention = {
      path: 'a.ts',
      side: 'head',
      startLine: 2,
      endLine: 3,
      sha: base.headSha,
    } as const;
    const messages: ChatMessage[] = [
      { ...base, role: 'user', content: 'old' },
      { ...base, role: 'summary', content: 'first summary' },
      { ...base, role: 'user', content: 'older' },
      { ...base, role: 'summary', content: 'second summary' },
      { ...base, role: 'user', content: 'Why [[@1]]?', mentions: [mention] },
      { ...base, role: 'assistant', kind: 'answer', status: 'complete', content: 'Because.' },
    ];
    expect(toChatHistory(messages)).toEqual([
      { role: 'user', content: 'Why [[@1]]?', mentions: [mention] },
      { role: 'assistant', content: 'Because.' },
    ]);
  });
});
