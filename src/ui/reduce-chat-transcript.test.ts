import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatMessageView } from '#contract/ipc-contract.ts';

import type { ChatEntry } from './chat-entry.ts';
import type { ChatTranscript } from './chat-entry.ts';
import { emptyChatTranscript } from './empty-chat-transcript.ts';
import { reduceChatTranscript } from './reduce-chat-transcript.ts';
import type { ChatTranscriptAction } from './reduce-chat-transcript.ts';

function base(): Pick<
  ChatMessageView,
  'sessionId' | 'headSha' | 'citations' | 'mentions' | 'createdAt'
> {
  return {
    sessionId: 's1',
    headSha: 'a'.repeat(40),
    citations: [],
    mentions: [],
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}
function question(): ChatMessageView {
  return {
    ...base(),
    id: 'q1',
    role: 'user',
    content: 'Why?',
    status: 'complete',
  };
}
function answer(): ChatMessageView {
  return {
    ...base(),
    id: 'a1',
    role: 'assistant',
    content: '',
    status: 'streaming',
  };
}
function note(): ChatEntry {
  return { id: 7, kind: 'note', tone: 'info', lines: ['hello'] };
}

describe('reduceChatTranscript', () => {
  test('puts a stored summary where the compaction entry was, once', ({ expect }) => {
    const summary: ChatMessageView = { ...question(), id: 's1', role: 'summary', content: 'Note.' };
    const compacting: ChatEntry = { id: 9, kind: 'compaction', status: 'running' };
    const start = { entries: [toMessage(question()), compacting, note()], pending: {} };
    const state = reduceChatTranscript(start, { kind: 'compacted', summary });
    expect(state.entries.map((entry) => entry.id)).toStrictEqual(['q1', 's1', 7]);
    expect(reduceChatTranscript(state, { kind: 'compacted', summary })).toBe(state);
    const appended = reduceChatTranscript(
      { entries: [note()], pending: {} },
      { kind: 'compacted', summary },
    );
    expect(appended.entries.map((entry) => entry.id)).toStrictEqual([7, 's1']);
  });

  test('appends the question and the streaming answer, then grows and resets the answer', ({
    expect,
  }) => {
    const state = run([
      { kind: 'asked', question: question(), answer: answer() },
      delta('append', 'Look'),
      delta('append', 'ing.'),
      delta('reset'),
      delta('append', 'It trims.'),
    ]);
    expect(state.entries.map((entry) => entry.id)).toStrictEqual(['q1', 'a1']);
    expect(contents(state)).toStrictEqual(['Why?', 'It trims.']);
  });

  test('finishes the answer with the stored message, after which deltas change nothing', ({
    expect,
  }) => {
    const done: ChatMessageView = {
      ...answer(),
      content: 'It trims [[a.ts:1-2]].',
      citations: [{ path: 'a.ts', startLine: 1, endLine: 2 }],
      status: 'complete',
    };
    const state = run([
      { kind: 'asked', question: question(), answer: answer() },
      delta('append', 'x'),
      { kind: 'updated', message: done },
      delta('append', 'late'),
    ]);
    expect(state.entries[1]).toStrictEqual({ id: 'a1', kind: 'message', message: done });
  });

  test('replays deltas and a final state that beat the ask response', ({ expect }) => {
    const early = run([
      delta('append', 'Hel'),
      delta('append', 'lo'),
      { kind: 'asked', question: question(), answer: answer() },
    ]);
    expect(contents(early)).toStrictEqual(['Why?', 'Hello']);
    expect(early.pending).toStrictEqual({});

    const done: ChatMessageView = { ...answer(), content: 'Hello.', status: 'complete' };
    const settled = run([
      delta('append', 'Hello'),
      { kind: 'updated', message: done },
      { kind: 'asked', question: question(), answer: answer() },
    ]);
    expect(settled.entries[1]).toMatchObject({
      message: { status: 'complete', content: 'Hello.' },
    });
  });

  test('loads history in front of the local entries and replaces earlier messages', ({
    expect,
  }) => {
    const first = run([{ kind: 'asked', question: question(), answer: answer() }], {
      entries: [note()],
      pending: {},
    });
    const loaded = run(
      [{ kind: 'loaded', messages: [question(), { ...answer(), status: 'cancelled' }] }],
      first,
    );
    expect(loaded.entries.map((entry) => entry.id)).toStrictEqual(['q1', 'a1', 7]);
    expect(loaded.entries[1]).toMatchObject({ message: { status: 'cancelled' } });
  });

  test('keeps the text of an answer streaming here when the stored history is reloaded', ({
    expect,
  }) => {
    const streaming = run([
      { kind: 'asked', question: question(), answer: answer() },
      delta('append', 'Fresh text'),
    ]);
    const loaded = run(
      [{ kind: 'loaded', messages: [question(), { ...answer(), content: 'Fre' }] }],
      streaming,
    );
    expect(contents(loaded)).toStrictEqual(['Why?', 'Fresh text']);
  });

  test('starts a queued answer when main says so, then streams into it', ({ expect }) => {
    const queued: ChatMessageView = { ...answer(), status: 'queued' };
    const state = run([
      { kind: 'asked', question: question(), answer: queued },
      delta('append', 'ignored while queued'),
      { kind: 'updated', message: { ...queued, status: 'streaming' } },
      delta('append', 'Now.'),
    ]);
    expect(state.entries[1]).toMatchObject({ message: { status: 'streaming', content: 'Now.' } });

    const early = run([
      { kind: 'updated', message: { ...queued, status: 'streaming' } },
      delta('append', 'Fast'),
      { kind: 'asked', question: question(), answer: queued },
    ]);
    expect(early.entries[1]).toMatchObject({ message: { status: 'streaming', content: 'Fast' } });
  });

  test('shows the latest progress line of a review until it settles, without touching its text', ({
    expect,
  }) => {
    const review: ChatMessageView = { ...answer(), answerKind: 'review' };
    const state = run([
      { kind: 'asked', question: question(), answer: review },
      delta('progress', 'Claude Code is reviewing 2 files'),
      delta('progress', 'Checking 2 findings against the code'),
    ]);
    expect(state.entries[1]).toMatchObject({
      progress: 'Checking 2 findings against the code',
      message: { content: '' },
    });
    const kept = run([{ kind: 'updated', message: review }], state);
    expect(kept.entries[1]).toMatchObject({ progress: 'Checking 2 findings against the code' });
    const done = run([{ kind: 'updated', message: { ...review, status: 'complete' } }], state);
    expect(done.entries[1]).toStrictEqual({
      id: 'a1',
      kind: 'message',
      message: { ...review, status: 'complete' },
    });
  });

  test('ignores a second ask response for the same answer and clears everything', ({ expect }) => {
    const once = run([{ kind: 'asked', question: question(), answer: answer() }]);
    expect(
      reduceChatTranscript(once, { kind: 'asked', question: question(), answer: answer() }),
    ).toBe(once);
    expect(
      reduceChatTranscript({ ...once, entries: [...once.entries, note()] }, { kind: 'cleared' }),
    ).toStrictEqual(emptyChatTranscript);
  });
});

function run(
  actions: readonly ChatTranscriptAction[],
  from: ChatTranscript = emptyChatTranscript,
): ChatTranscript {
  let state = from;
  for (const action of actions) {
    state = reduceChatTranscript(state, action);
  }
  return state;
}

function delta(kind: 'append' | 'reset' | 'progress', text = ''): ChatTranscriptAction {
  return { kind: 'delta', delta: { sessionId: 's1', messageId: 'a1', kind, text } };
}

function contents(state: ChatTranscript): string[] {
  return state.entries.flatMap((entry) => (entry.kind === 'message' ? entry.message.content : []));
}

function toMessage(message: ChatMessageView): ChatEntry {
  return { id: message.id, kind: 'message', message };
}
