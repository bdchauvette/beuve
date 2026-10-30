import { describe } from 'vitest';

import type { ChatMessage, ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { chatHistoryFrom } from './chat-history-from.ts';
import { chatPartsFrom } from './chat-parts-from.ts';
import { test } from './testing/test.ts';

describe('chatHistoryFrom', () => {
  test('keeps questions and completed answers, in order', ({ expect }) => {
    const messages: ChatMessage[] = [
      { ...base(), role: 'user', parts: chatPartsFrom('q1') },
      { ...base(), role: 'assistant', kind: 'answer', status: 'done', parts: chatPartsFrom('a1') },
      { ...base(), role: 'system-notice', parts: chatPartsFrom('Head moved.') },
      { ...base(), role: 'user', parts: chatPartsFrom('q2') },
      {
        ...base(),
        role: 'assistant',
        kind: 'answer',
        status: 'error',
        parts: [{ kind: 'error', id: 'p1', code: 'timeout' }],
      },
      {
        ...base(),
        role: 'assistant',
        kind: 'answer',
        status: 'cancelled',
        parts: chatPartsFrom('partial'),
      },
      {
        ...base(),
        role: 'assistant',
        kind: 'answer',
        status: 'streaming',
        parts: chatPartsFrom('live'),
      },
    ];
    expect(chatHistoryFrom(messages)).toStrictEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  test('sends a /review answer as its findings in Markdown', ({ expect }) => {
    const messages: ChatMessage[] = [
      { ...base(), role: 'user', parts: chatPartsFrom('/review') },
      {
        ...base(),
        role: 'assistant',
        kind: 'review',
        status: 'done',
        parts: [{ kind: 'finding', id: 'p1', finding: 0 }],
        review: {
          findings: [
            {
              path: 'a.ts',
              startLine: 2,
              endLine: 2,
              severity: 'risk',
              category: 'edge-case',
              title: 'Empty input',
              body: 'It throws.',
              confidence: 0.8,
              check: 'confirmed',
            },
          ],
          dropped: {
            unknownFile: 0,
            outsideDiff: 0,
            lowConfidence: 0,
            duplicate: 0,
            overLimit: 0,
            unconfirmed: 0,
          },
          pathScope: [],
          fileCount: 1,
          verification: 'verified',
        },
      },
    ];
    expect(chatHistoryFrom(messages)).toStrictEqual([
      { role: 'user', content: '/review' },
      {
        role: 'assistant',
        content:
          '**Review** of 1 file: 1 finding.\n\n- **risk, edge-case** Empty input [[a.ts:2-2]] ' +
          '(confidence 0.80, confirmed): It throws.',
      },
    ]);
  });

  test('keeps a question’s mentions and only the turns after the latest summary', ({ expect }) => {
    const mention = {
      path: 'a.ts',
      side: 'head',
      startLine: 2,
      endLine: 3,
      sha: base().headSha,
    } as const;
    const messages: ChatMessage[] = [
      { ...base(), role: 'user', parts: chatPartsFrom('old') },
      { ...base(), role: 'summary', parts: chatPartsFrom('first summary') },
      { ...base(), role: 'user', parts: chatPartsFrom('older') },
      { ...base(), role: 'summary', parts: chatPartsFrom('second summary') },
      { ...base(), role: 'user', parts: chatPartsFrom('Why [[@1]]?', [mention]) },
      {
        ...base(),
        role: 'assistant',
        kind: 'answer',
        status: 'done',
        parts: chatPartsFrom('Because.'),
      },
    ];
    expect(chatHistoryFrom(messages)).toStrictEqual([
      { role: 'user', content: 'Why [[@1]]?', mentions: [mention] },
      { role: 'assistant', content: 'Because.' },
    ]);
  });
});

function base(): {
  id: ChatMessageId;
  sessionId: SessionId;
  headSha: CommitSha;
  citations: [];
  createdAt: string;
} {
  return {
    id: '00000000-0000-4000-8000-000000000001' as ChatMessageId,
    sessionId: '11111111-1111-4111-8111-111111111111' as SessionId,
    headSha: 'c'.repeat(40) as CommitSha,
    citations: [],
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}
