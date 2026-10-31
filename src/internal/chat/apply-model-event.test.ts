import { describe } from 'vitest';

import { applyModelEvent } from './apply-model-event.ts';
import type { ModelStreamEvent, StreamedParts } from './apply-model-event.ts';
import type { ChatPartEvent } from './chat-part-event.ts';
import { test } from './testing/test.ts';

/** Folds `events` from a fresh run; gives the final state and every part event in order. */
/** A run's final parts, and every part event it emitted. */
interface Folded {
  readonly state: StreamedParts;
  readonly emitted: ChatPartEvent[];
}

function fold(events: readonly ModelStreamEvent[]): Folded {
  let state: StreamedParts = { parts: [], nextId: 1, tools: {} };
  const emitted: ChatPartEvent[] = [];
  for (const event of events) {
    const applied = applyModelEvent(state, event);
    state = applied.state;
    emitted.push(...applied.events);
  }
  return { state, emitted };
}

describe('applyModelEvent', () => {
  test('streams reasoning, a tool call and text as parts', ({ expect }) => {
    const { state, emitted } = fold([
      { kind: 'progress', progress: { kind: 'started', model: 'm' } },
      { kind: 'progress', progress: { kind: 'thinking' } },
      { kind: 'progress', progress: { kind: 'thinking' } },
      {
        kind: 'progress',
        progress: { kind: 'tool-start', id: 't1', tool: 'Read', description: 'read a.ts:1-40' },
      },
      { kind: 'progress', progress: { kind: 'tool-end', id: 't1', tool: 'Read', ok: true } },
      { kind: 'progress', progress: { kind: 'text-start' } },
      { kind: 'text', delta: { kind: 'append', text: 'Because ' } },
      { kind: 'text', delta: { kind: 'append', text: 'a.' } },
      { kind: 'progress', progress: { kind: 'text-end' } },
    ]);
    const reading = {
      kind: 'tool-call',
      id: 'p2',
      tool: 'Read',
      description: 'read a.ts:1-40',
    } as const;
    expect(emitted).toStrictEqual([
      { type: 'part-start', part: { kind: 'reasoning', id: 'p1', state: 'running' } },
      { type: 'part-end', part: { kind: 'reasoning', id: 'p1', state: 'done' } },
      { type: 'part-start', part: { ...reading, state: 'running' } },
      { type: 'part-end', part: { ...reading, state: 'done' } },
      { type: 'part-start', part: { kind: 'text', id: 'p3', text: '' } },
      { type: 'text-delta', partId: 'p3', text: 'Because ' },
      { type: 'text-delta', partId: 'p3', text: 'a.' },
      { type: 'part-end', part: { kind: 'text', id: 'p3', text: 'Because a.' } },
    ]);
    expect(state).toStrictEqual({
      parts: [
        { kind: 'reasoning', id: 'p1', state: 'done' },
        { ...reading, state: 'done' },
        { kind: 'text', id: 'p3', text: 'Because a.' },
      ],
      nextId: 4,
      tools: {},
    });
  });

  test('discards text written before a tool call and never reuses its id', ({ expect }) => {
    const { state, emitted } = fold([
      { kind: 'text', delta: { kind: 'append', text: 'Let me look.' } },
      {
        kind: 'progress',
        progress: { kind: 'tool-start', id: 't1', tool: 'Grep', description: 'grep x' },
      },
      { kind: 'text', delta: { kind: 'reset' } },
      { kind: 'text', delta: { kind: 'append', text: 'Found it.' } },
    ]);
    expect(emitted.map((event) => event.type)).toStrictEqual([
      'part-start',
      'text-delta',
      'part-start',
      'part-discard',
      'part-start',
      'text-delta',
    ]);
    expect(state.parts.map((part) => part.id)).toStrictEqual(['p2', 'p3']);
    expect(state.openText).toBe('p3');
  });

  test('a new reasoning summary starts a new part', ({ expect }) => {
    const { state } = fold([
      { kind: 'progress', progress: { kind: 'thinking', summary: 'Reading the diff' } },
      { kind: 'progress', progress: { kind: 'thinking', summary: 'Reading the diff' } },
      { kind: 'progress', progress: { kind: 'thinking', summary: 'Weighing callers' } },
    ]);
    expect(state.parts).toStrictEqual([
      { kind: 'reasoning', id: 'p1', state: 'done', summary: 'Reading the diff' },
      { kind: 'reasoning', id: 'p2', state: 'running', summary: 'Weighing callers' },
    ]);
  });

  test('stop ends what is open, a running tool as stopped', ({ expect }) => {
    const { state, emitted } = fold([
      {
        kind: 'progress',
        progress: { kind: 'tool-start', id: 't1', tool: 'Grep', description: 'grep x' },
      },
      { kind: 'progress', progress: { kind: 'tool-end', id: 'unknown', tool: 'Grep', ok: false } },
      { kind: 'progress', progress: { kind: 'thinking' } },
      { kind: 'stop' },
    ]);
    expect(state).toStrictEqual({
      parts: [
        { kind: 'tool-call', id: 'p1', tool: 'Grep', description: 'grep x', state: 'stopped' },
        { kind: 'reasoning', id: 'p2', state: 'done' },
      ],
      nextId: 3,
      tools: {},
    });
    expect(emitted.at(-1)).toStrictEqual({
      type: 'part-end',
      part: { kind: 'tool-call', id: 'p1', tool: 'Grep', description: 'grep x', state: 'stopped' },
    });
  });
});
