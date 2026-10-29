import { describe, expect, it } from 'vitest';

import type { ChatMessageView } from '#contract/ipc-contract.ts';

import type { ChatEntry } from './chat-entry.ts';
import type { ChatTranscript } from './chat-entry.ts';
import { emptyChatTranscript } from './empty-chat-transcript.ts';
import { reduceChatTranscript } from './reduce-chat-transcript.ts';
import type { ChatTranscriptAction } from './reduce-chat-transcript.ts';

const base = {
  sessionId: 's1',
  headSha: 'a'.repeat(40),
  citations: [],
  mentions: [],
  createdAt: '2026-10-28T12:00:00.000Z',
};
const question: ChatMessageView = {
  ...base,
  id: 'q1',
  role: 'user',
  content: 'Why?',
  status: 'complete',
};
const answer: ChatMessageView = {
  ...base,
  id: 'a1',
  role: 'assistant',
  content: '',
  status: 'streaming',
};
const note: ChatEntry = { id: 7, kind: 'note', tone: 'info', lines: ['hello'] };

describe('reduceChatTranscript', () => {
  it('puts a stored summary where the compaction entry was, once', () => {
    const summary: ChatMessageView = { ...question, id: 's1', role: 'summary', content: 'Note.' };
    const compacting: ChatEntry = { id: 9, kind: 'compaction', status: 'running' };
    const start = { entries: [toMessage(question), compacting, note], pending: {} };
    const state = reduceChatTranscript(start, { kind: 'compacted', summary });
    expect(state.entries.map((entry) => entry.id)).toEqual(['q1', 's1', 7]);
    expect(reduceChatTranscript(state, { kind: 'compacted', summary })).toBe(state);
    const appended = reduceChatTranscript(
      { entries: [note], pending: {} },
      { kind: 'compacted', summary },
    );
    expect(appended.entries.map((entry) => entry.id)).toEqual([7, 's1']);
  });

  it('appends the question and the streaming answer, then grows and resets the answer', () => {
    const state = run([
      { kind: 'asked', question, answer },
      delta('append', 'Look'),
      delta('append', 'ing.'),
      delta('reset'),
      delta('append', 'It trims.'),
    ]);
    expect(state.entries.map((entry) => entry.id)).toEqual(['q1', 'a1']);
    expect(contents(state)).toEqual(['Why?', 'It trims.']);
  });

  it('finishes the answer with the stored message, after which deltas change nothing', () => {
    const done: ChatMessageView = {
      ...answer,
      content: 'It trims [[a.ts:1-2]].',
      citations: [{ path: 'a.ts', startLine: 1, endLine: 2 }],
      status: 'complete',
    };
    const state = run([
      { kind: 'asked', question, answer },
      delta('append', 'x'),
      { kind: 'updated', message: done },
      delta('append', 'late'),
    ]);
    expect(state.entries[1]).toEqual({ id: 'a1', kind: 'message', message: done });
  });

  it('replays deltas and a final state that beat the ask response', () => {
    const early = run([
      delta('append', 'Hel'),
      delta('append', 'lo'),
      { kind: 'asked', question, answer },
    ]);
    expect(contents(early)).toEqual(['Why?', 'Hello']);
    expect(early.pending).toEqual({});

    const done: ChatMessageView = { ...answer, content: 'Hello.', status: 'complete' };
    const settled = run([
      delta('append', 'Hello'),
      { kind: 'updated', message: done },
      { kind: 'asked', question, answer },
    ]);
    expect(settled.entries[1]).toMatchObject({
      message: { status: 'complete', content: 'Hello.' },
    });
  });

  it('loads history in front of the local entries and replaces earlier messages', () => {
    const first = run([{ kind: 'asked', question, answer }], { entries: [note], pending: {} });
    const loaded = run(
      [{ kind: 'loaded', messages: [question, { ...answer, status: 'cancelled' }] }],
      first,
    );
    expect(loaded.entries.map((entry) => entry.id)).toEqual(['q1', 'a1', 7]);
    expect(loaded.entries[1]).toMatchObject({ message: { status: 'cancelled' } });
  });

  it('keeps the text of an answer streaming here when the stored history is reloaded', () => {
    const streaming = run([{ kind: 'asked', question, answer }, delta('append', 'Fresh text')]);
    const loaded = run(
      [{ kind: 'loaded', messages: [question, { ...answer, content: 'Fre' }] }],
      streaming,
    );
    expect(contents(loaded)).toEqual(['Why?', 'Fresh text']);
  });

  it('ignores a second ask response for the same answer and clears everything', () => {
    const once = run([{ kind: 'asked', question, answer }]);
    expect(reduceChatTranscript(once, { kind: 'asked', question, answer })).toBe(once);
    expect(
      reduceChatTranscript({ ...once, entries: [...once.entries, note] }, { kind: 'cleared' }),
    ).toEqual(emptyChatTranscript);
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

function delta(kind: 'append' | 'reset', text = ''): ChatTranscriptAction {
  return { kind: 'delta', delta: { sessionId: 's1', messageId: 'a1', kind, text } };
}

function contents(state: ChatTranscript): string[] {
  return state.entries.flatMap((entry) => (entry.kind === 'message' ? entry.message.content : []));
}

function toMessage(message: ChatMessageView): ChatEntry {
  return { id: message.id, kind: 'message', message };
}
