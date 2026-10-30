import { describe, expect, it } from 'vitest';

import { appendChatMessage } from './append-chat-message.ts';
import type { ChatMessage, ChatMessageId, CommitSha, SessionId } from './chat-message.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { createChatTestDatabase } from './testing/create-chat-test-database.ts';

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const headSha = 'c'.repeat(40) as CommitSha;

function id(index: number): ChatMessageId {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` as ChatMessageId;
}

describe('appendChatMessage', () => {
  it('round-trips every role and status, in transcript order', () => {
    const db = createChatTestDatabase([sessionId]);
    const at = '2026-10-28T12:00:00.000Z';
    const base = { sessionId, headSha, citations: [], mentions: [], createdAt: at };
    const messages: ChatMessage[] = [
      { ...base, id: id(1), role: 'user', content: 'Why?' },
      {
        ...base,
        id: id(2),
        role: 'assistant',
        kind: 'answer',
        status: 'complete',
        content: 'Because [[src/a.ts:12-13]].',
        citations: [{ path: 'src/a.ts', startLine: 12, endLine: 13, side: 'head' }],
      },
      { ...base, id: id(3), role: 'user', content: 'And?' },
      {
        ...base,
        id: id(4),
        role: 'assistant',
        kind: 'answer',
        status: 'failed',
        errorCode: 'timeout',
        content: '',
      },
      { ...base, id: id(5), role: 'system-notice', content: 'Head moved to cccc.' },
      {
        ...base,
        id: id(6),
        role: 'assistant',
        kind: 'answer',
        status: 'cancelled',
        content: 'Partial',
      },
      { ...base, id: id(10), role: 'assistant', kind: 'abstract', status: 'queued', content: '' },
      {
        ...base,
        id: id(11),
        role: 'assistant',
        kind: 'review',
        status: 'complete',
        content: '**Review** of 1 file: 1 finding.',
        review: {
          findings: [
            {
              path: 'src/a.ts',
              startLine: 12,
              endLine: 12,
              severity: 'risk',
              category: 'edge-case',
              title: 'Empty input',
              body: 'An empty string yields `undefined`.',
              confidence: 0.8,
              check: 'confirmed',
            },
          ],
          dropped: {
            unknownFile: 0,
            outsideDiff: 1,
            lowConfidence: 0,
            duplicate: 0,
            overLimit: 0,
            unconfirmed: 1,
          },
          pathScope: ['src'],
          fileCount: 1,
          verification: 'verified',
        },
      },
      {
        ...base,
        id: id(7),
        role: 'user',
        content: 'Why [[@1]] and [[@2]]?',
        mentions: [
          { path: 'src/a.ts', side: 'head', startLine: 27, endLine: 33, sha: headSha },
          { path: 'src/old.ts', side: 'base', sha: 'b'.repeat(40) as CommitSha },
        ],
      },
      {
        ...base,
        id: id(8),
        role: 'summary',
        content: '**Asked**\n- why [[src/a.ts:27-33]]',
        citations: [{ path: 'src/a.ts', startLine: 27, endLine: 33, side: 'head' }],
      },
    ];
    for (const message of messages) {
      expect(appendChatMessage(db, message)).toEqual({ ok: true, value: undefined });
    }
    expect(listChatMessages(db, sessionId)).toEqual({ ok: true, value: messages });
  });

  it('reports an unknown session and a reused id', () => {
    const db = createChatTestDatabase([sessionId]);
    const message: ChatMessage = {
      id: id(1),
      sessionId,
      headSha,
      role: 'user',
      content: 'Why?',
      citations: [],
      mentions: [],
      createdAt: '2026-10-28T12:00:00.000Z',
    };
    const other = '22222222-2222-4222-8222-222222222222' as SessionId;
    expect(appendChatMessage(db, { ...message, sessionId: other })).toEqual({
      ok: false,
      error: { kind: 'session-not-found', sessionId: other },
    });
    appendChatMessage(db, message);
    expect(appendChatMessage(db, message)).toEqual({
      ok: false,
      error: { kind: 'duplicate-message', id: id(1) },
    });
  });
});
