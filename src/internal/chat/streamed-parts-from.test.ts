import { describe } from 'vitest';

import { answerPartsFrom } from './answer-parts-from.ts';
import { streamedPartsFrom } from './streamed-parts-from.ts';
import { test } from './testing/test.ts';

describe('streamedPartsFrom', () => {
  test('lets a stored, unfinished answer end like a run', ({ expect }) => {
    const parts = [
      { kind: 'tool-call', id: 'p4', tool: 'Grep', description: 'grep x', state: 'running' },
      { kind: 'reasoning', id: 'p7', state: 'running' },
    ] as const;
    expect(streamedPartsFrom(parts)).toStrictEqual({ parts, nextId: 8, tools: { p4: 'p4' } });
    expect(answerPartsFrom(streamedPartsFrom(parts), { kind: 'error', code: 'x' })).toStrictEqual([
      { kind: 'tool-call', id: 'p4', tool: 'Grep', description: 'grep x', state: 'stopped' },
      { kind: 'reasoning', id: 'p7', state: 'done' },
      { kind: 'error', id: 'p8', code: 'x' },
    ]);
    expect(streamedPartsFrom([])).toStrictEqual({ parts: [], nextId: 1, tools: {} });
  });
});
