import { describe } from 'vitest';

import { answerPartsFrom } from './answer-parts-from.ts';
import type { StreamedParts } from './apply-model-event.ts';
import { test } from './testing/test.ts';

function streamed(): StreamedParts {
  return {
    parts: [
      { kind: 'tool-call', id: 'p1', tool: 'Read', description: 'read a.ts', state: 'running' },
      { kind: 'text', id: 'p2', text: 'Because [[a.ts:9-9]]' },
    ],
    nextId: 3,
    openText: 'p2',
    tools: { t1: 'p1' },
  };
}

describe('answerPartsFrom', () => {
  test('replaces the streamed text with the validated answer, keeping its id', ({ expect }) => {
    expect(answerPartsFrom(streamed(), { kind: 'text', text: 'Because.' })).toStrictEqual([
      { kind: 'tool-call', id: 'p1', tool: 'Read', description: 'read a.ts', state: 'stopped' },
      { kind: 'text', id: 'p2', text: 'Because.' },
    ]);
    expect(
      answerPartsFrom({ parts: [], nextId: 1, tools: {} }, { kind: 'text', text: 'Hi' }),
    ).toStrictEqual([{ kind: 'text', id: 'p1', text: 'Hi' }]);
    expect(answerPartsFrom(streamed(), { kind: 'text', text: '' })).toHaveLength(1);
  });

  test('ends a review with its findings, a failure with an error part', ({ expect }) => {
    expect(answerPartsFrom(streamed(), { kind: 'findings', count: 2 })).toStrictEqual([
      { kind: 'tool-call', id: 'p1', tool: 'Read', description: 'read a.ts', state: 'stopped' },
      { kind: 'finding', id: 'p3', finding: 0 },
      { kind: 'finding', id: 'p4', finding: 1 },
    ]);
    expect(answerPartsFrom(streamed(), { kind: 'error', code: 'timeout' })).toStrictEqual([
      { kind: 'tool-call', id: 'p1', tool: 'Read', description: 'read a.ts', state: 'stopped' },
      { kind: 'text', id: 'p2', text: 'Because [[a.ts:9-9]]' },
      { kind: 'error', id: 'p3', code: 'timeout' },
    ]);
    expect(answerPartsFrom(streamed(), { kind: 'cancelled' })).toHaveLength(2);
  });
});
