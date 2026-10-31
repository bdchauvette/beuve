import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatMessageView, ChatPartView, ChatStreamEvent } from '#contract/ipc-contract.ts';

import type { ChatEntry } from './chat-entry.ts';
import type { ChatTranscript } from './chat-entry.ts';
import { emptyChatTranscript } from './empty-chat-transcript.ts';
import { reduceChatTranscript } from './reduce-chat-transcript.ts';
import type { ChatTranscriptAction } from './reduce-chat-transcript.ts';

function base(): Pick<ChatMessageView, 'sessionId' | 'headSha' | 'citations' | 'createdAt'> {
  return {
    sessionId: 's1',
    headSha: 'a'.repeat(40),
    citations: [],
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}

function question(): ChatMessageView {
  return {
    ...base(),
    id: 'q1',
    role: 'user',
    parts: [{ kind: 'text', id: 'p1', text: 'Why?' }],
    status: 'done',
  };
}

function answer(status: ChatMessageView['status'] = 'submitted'): ChatMessageView {
  return { ...base(), id: 'a1', role: 'assistant', parts: [], status };
}

function note(): ChatEntry {
  return { id: 7, kind: 'note', tone: 'info', lines: ['hello'] };
}

function grep(state: 'running' | 'done'): ChatPartView {
  return { kind: 'tool-call', id: 'p1', tool: 'Grep', description: 'grep trim', state };
}

describe('reduceChatTranscript', () => {
  test('streams an answer as parts: status, a tool call, then text deltas', ({ expect }) => {
    const state = run([
      asked(),
      stream({ type: 'status', status: 'streaming' }),
      stream({ type: 'part-start', part: grep('running') }),
      stream({ type: 'part-end', part: grep('done') }),
      stream({ type: 'part-start', part: { kind: 'text', id: 'p2', text: '' } }),
      stream({ type: 'text-delta', partId: 'p2', text: 'It ' }),
      stream({ type: 'text-delta', partId: 'p2', text: 'trims.' }),
    ]);
    expect(state.entries.map((entry) => entry.id)).toStrictEqual(['q1', 'a1']);
    expect(answerIn(state)).toStrictEqual({
      ...answer('streaming'),
      parts: [grep('done'), { kind: 'text', id: 'p2', text: 'It trims.' }],
    });
  });

  test('discards a text part the model abandoned before a tool call', ({ expect }) => {
    const state = run([
      asked(),
      stream({ type: 'part-start', part: { kind: 'text', id: 'p1', text: '' } }),
      stream({ type: 'text-delta', partId: 'p1', text: 'Looking.' }),
      stream({ type: 'part-start', part: { ...grep('running'), id: 'p2' } }),
      stream({ type: 'part-discard', partId: 'p1' }),
      stream({ type: 'part-start', part: { kind: 'text', id: 'p3', text: '' } }),
      stream({ type: 'text-delta', partId: 'p3', text: 'Found.' }),
    ]);
    expect(answerIn(state)?.parts).toStrictEqual([
      { ...grep('running'), id: 'p2' },
      { kind: 'text', id: 'p3', text: 'Found.' },
    ]);
  });

  test('ends the answer with the stored message, after which events change nothing', ({
    expect,
  }) => {
    const done: ChatMessageView = {
      ...answer('done'),
      parts: [{ kind: 'text', id: 'p1', text: 'It trims [[a.ts:1-2]].' }],
      citations: [{ path: 'a.ts', startLine: 1, endLine: 2 }],
    };
    const state = run([
      asked(),
      stream({ type: 'status', status: 'streaming', activity: 'Reading' }),
      stream({ type: 'part-start', part: { kind: 'text', id: 'p1', text: '' } }),
      stream({ type: 'message', message: done }),
      stream({ type: 'text-delta', partId: 'p1', text: 'late' }),
      stream({ type: 'status', status: 'streaming' }),
    ]);
    expect(state.entries[1]).toStrictEqual({ id: 'a1', kind: 'message', message: done });
  });

  test('replays events that beat the ask response, in order', ({ expect }) => {
    const early = run([
      stream({ type: 'status', status: 'streaming' }),
      stream({ type: 'part-start', part: { kind: 'text', id: 'p1', text: '' } }),
      stream({ type: 'text-delta', partId: 'p1', text: 'Hel' }),
      stream({ type: 'text-delta', partId: 'p1', text: 'lo' }),
      asked(),
    ]);
    expect(answerIn(early)).toMatchObject({
      status: 'streaming',
      parts: [{ kind: 'text', text: 'Hello' }],
    });
    expect(early.pending).toStrictEqual({});

    const ended = run([
      stream({ type: 'part-start', part: { kind: 'text', id: 'p1', text: '' } }),
      stream({ type: 'message', message: { ...answer('cancelled'), parts: [] } }),
      asked(),
    ]);
    expect(answerIn(ended)).toStrictEqual({ ...answer('cancelled'), parts: [] });
  });

  test('takes a queued answer through submitted and streaming as main says', ({ expect }) => {
    const started = [
      asked('queued'),
      stream({ type: 'status', status: 'submitted' }),
      stream({ type: 'status', status: 'streaming' }),
      stream({ type: 'message', message: answer('done') }),
    ];
    expect(statusesAlong(started)).toStrictEqual(['queued', 'submitted', 'streaming', 'done']);
    const dropped = [asked('queued'), stream({ type: 'message', message: answer('cancelled') })];
    expect(statusesAlong(dropped)).toStrictEqual(['queued', 'cancelled']);
  });

  test('keeps the latest activity line until the request ends', ({ expect }) => {
    const state = run([
      asked(),
      stream({ type: 'status', status: 'submitted', activity: 'Building the review diff' }),
      stream({ type: 'status', status: 'streaming' }),
      stream({ type: 'status', status: 'streaming', activity: 'Checking 2 findings' }),
    ]);
    expect(state.entries[1]).toMatchObject({ activity: 'Checking 2 findings' });
    const kept = run([stream({ type: 'message', message: answer('streaming') })], state);
    expect(kept.entries[1]).toMatchObject({ activity: 'Checking 2 findings' });
    const done = run([stream({ type: 'message', message: answer('done') })], state);
    expect(done.entries[1]).toStrictEqual({ id: 'a1', kind: 'message', message: answer('done') });
  });

  test('loads history in front of the local entries and replaces ended messages', ({ expect }) => {
    const first = run([asked()], { entries: [note()], pending: {} });
    const loaded = run([{ kind: 'loaded', messages: [question(), answer('cancelled')] }], first);
    expect(loaded.entries.map((entry) => entry.id)).toStrictEqual(['q1', 'a1', 7]);
    expect(answerIn(loaded)?.status).toBe('cancelled');
  });

  test('keeps the parts of a request running here when the history is reloaded', ({ expect }) => {
    const streaming = run([
      asked(),
      stream({ type: 'part-start', part: { kind: 'text', id: 'p1', text: 'Fresh text' } }),
    ]);
    const stale: ChatMessageView = {
      ...answer('streaming'),
      parts: [{ kind: 'text', id: 'p1', text: 'Fre' }],
    };
    const loaded = run([{ kind: 'loaded', messages: [question(), stale] }], streaming);
    expect(answerIn(loaded)?.parts).toStrictEqual([{ kind: 'text', id: 'p1', text: 'Fresh text' }]);
  });

  test('puts a stored summary where the compaction entry was, once', ({ expect }) => {
    const summary: ChatMessageView = { ...question(), id: 's1', role: 'summary' };
    const compacting: ChatEntry = { id: 9, kind: 'compaction', status: 'running' };
    const start = { entries: [messageFrom(question()), compacting, note()], pending: {} };
    const state = reduceChatTranscript(start, { kind: 'compacted', summary });
    expect(state.entries.map((entry) => entry.id)).toStrictEqual(['q1', 's1', 7]);
    expect(reduceChatTranscript(state, { kind: 'compacted', summary })).toBe(state);
    const appended = reduceChatTranscript(
      { entries: [note()], pending: {} },
      { kind: 'compacted', summary },
    );
    expect(appended.entries.map((entry) => entry.id)).toStrictEqual([7, 's1']);
  });

  test('ignores a second ask response for the same answer and clears everything', ({ expect }) => {
    const once = run([asked()]);
    expect(reduceChatTranscript(once, asked())).toBe(once);
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

function asked(status: ChatMessageView['status'] = 'submitted'): ChatTranscriptAction {
  return { kind: 'asked', question: question(), answer: answer(status) };
}

/** A `chat:stream` event of answer `a1`. */
function stream(
  event: DistributiveOmit<ChatStreamEvent, 'sessionId' | 'messageId'>,
): ChatTranscriptAction {
  return { kind: 'stream', event: { ...event, sessionId: 's1', messageId: 'a1' } };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The answer's status after each action. */
function statusesAlong(actions: readonly ChatTranscriptAction[]): string[] {
  const seen: string[] = [];
  let state = emptyChatTranscript;
  for (const action of actions) {
    state = reduceChatTranscript(state, action);
    seen.push(answerIn(state)?.status ?? 'unknown');
  }
  return seen;
}

/** The second entry's message: the answer, after the question. */
function answerIn(state: ChatTranscript): ChatMessageView | undefined {
  const entry = state.entries[1];
  if (entry?.kind === 'message') {
    return entry.message;
  }
  return undefined;
}

function messageFrom(message: ChatMessageView): ChatEntry {
  return { id: message.id, kind: 'message', message };
}
