import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { appendChatMessage } from './append-chat-message.ts';
import type { ChatMessage, ChatMessageId, ChatPart, CommitSha, SessionId } from './chat-message.ts';
import type { NoteProposal } from './note-proposal.ts';
import { chatPartsFrom } from './chat-parts-from.ts';
import { listChatMessages } from './list-chat-messages.ts';
import { updateChatAnswer } from './update-chat-answer.ts';
import { test } from './testing/test.ts';

function seed(db: DatabaseSync): void {
  appendChatMessage(db, {
    ...base(),
    id: questionId(),
    role: 'user',
    parts: chatPartsFrom('Why?'),
  });
  appendChatMessage(db, {
    ...base(),
    id: answerId(),
    role: 'assistant',
    kind: 'answer',
    status: 'submitted',
    parts: [],
  });
}

function storedNote(): NoteProposal {
  return { path: 'a.ts', startLine: 2, endLine: 3, label: 'issue', title: 'T', body: '' };
}

function answer(db: DatabaseSync): ChatMessage | undefined {
  const listed = listChatMessages(db, sessionId());
  if (listed.ok) {
    return listed.value[1];
  }
  return undefined;
}

describe('updateChatAnswer', () => {
  test('streams parts, then stores the final answer with its citations', ({ expect, db }) => {
    seed(db);
    const reading = {
      kind: 'tool-call',
      id: 'p1',
      tool: 'Read',
      description: 'read src/a.ts',
      state: 'running',
    } as const;
    expect(
      updateChatAnswer(db, answerId(), {
        status: 'streaming',
        parts: [reading, { kind: 'text', id: 'p2', text: 'Because' }],
      }),
    ).toStrictEqual({ ok: true, value: undefined });
    expect(answer(db)).toMatchObject({
      status: 'streaming',
      parts: [reading, { kind: 'text', id: 'p2', text: 'Because' }],
      citations: [],
    });
    const citations = [{ path: 'src/a.ts', startLine: 1, endLine: 2, side: 'head' as const }];
    const parts = [
      { ...reading, state: 'done' },
      { kind: 'text', id: 'p2', text: 'Because [[src/a.ts:1-2]].' },
    ] as const;
    updateChatAnswer(db, answerId(), { status: 'done', parts, citations });
    expect(answer(db)).toStrictEqual({
      ...base(),
      id: answerId(),
      role: 'assistant',
      kind: 'answer',
      status: 'done',
      parts,
      citations,
    });
  });

  test('stores proposed notes, kept and dropped, and reads them back', ({ expect, db }) => {
    seed(db);
    const note = { path: 'a.ts', startLine: 2, endLine: 3, label: 'nit', title: '', body: 'B' };
    const parts = [
      { kind: 'text', id: 'p1', text: 'See below.' },
      { kind: 'proposal', id: 'p2', proposal: 0, note },
      { kind: 'dropped-proposal', id: 'p3', reason: 'outside-diff' },
      { kind: 'proposal', id: 'p4', proposal: 1, note: { ...note, title: 'T' } },
    ] as const;
    updateChatAnswer(db, answerId(), { status: 'done', parts });
    expect(answer(db)).toMatchObject({ status: 'done', parts });
  });

  test.for<[string, readonly ChatPart[]]>([
    [
      'numbered out of order',
      [
        { kind: 'proposal', id: 'p1', proposal: 1, note: storedNote() },
        { kind: 'proposal', id: 'p2', proposal: 0, note: storedNote() },
      ],
    ],
    [
      'on lines that are not lines',
      [{ kind: 'proposal', id: 'p1', proposal: 0, note: { ...storedNote(), startLine: 0 } }],
    ],
  ])('reads proposals %s as a corrupt row', ([, parts], { expect, db }) => {
    seed(db);
    updateChatAnswer(db, answerId(), { status: 'done', parts });
    expect(listChatMessages(db, sessionId())).toMatchObject({
      ok: false,
      error: { kind: 'corrupt-row', id: answerId() },
    });
  });

  test('records a failure as an error part, and replaces it again', ({ expect, db }) => {
    seed(db);
    updateChatAnswer(db, answerId(), {
      status: 'error',
      parts: [{ kind: 'error', id: 'p1', code: 'rate-limited' }],
    });
    expect(answer(db)).toMatchObject({
      status: 'error',
      parts: [{ kind: 'error', code: 'rate-limited' }],
    });
    updateChatAnswer(db, answerId(), { status: 'cancelled', parts: chatPartsFrom('Part') });
    expect(answer(db)).toMatchObject({ status: 'cancelled', parts: chatPartsFrom('Part') });
  });

  test('updates only existing assistant messages', ({ expect, db }) => {
    seed(db);
    expect(
      updateChatAnswer(db, questionId(), { status: 'done', parts: chatPartsFrom('x') }),
    ).toStrictEqual({
      ok: false,
      error: { kind: 'message-not-found', id: questionId() },
    });
    const missing = '00000000-0000-4000-8000-000000000009' as ChatMessageId;
    expect(
      updateChatAnswer(db, missing, { status: 'done', parts: chatPartsFrom('x') }),
    ).toMatchObject({
      ok: false,
    });
  });
});

function sessionId(): SessionId {
  return '11111111-1111-4111-8111-111111111111' as SessionId;
}

function base(): Pick<ChatMessage, 'sessionId' | 'headSha' | 'citations' | 'createdAt'> {
  return {
    sessionId: sessionId(),
    headSha: 'c'.repeat(40) as CommitSha,
    citations: [],
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}

function questionId(): ChatMessageId {
  return '00000000-0000-4000-8000-000000000001' as ChatMessageId;
}

function answerId(): ChatMessageId {
  return '00000000-0000-4000-8000-000000000002' as ChatMessageId;
}
