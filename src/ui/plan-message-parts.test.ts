import { describe } from 'vitest';

import type { ChatPartView } from '#contract/ipc-contract.ts';

import { planMessageParts } from './plan-message-parts.ts';
import { test } from './testing/test.ts';

function tool(id: string, state: 'running' | 'done' | 'failed'): ChatPartView {
  return { kind: 'tool-call', id, tool: 'Read', description: `read ${id}.ts`, state };
}

describe('planMessageParts', () => {
  test('groups each run of reasoning and tool calls, between the other parts', ({ expect }) => {
    const thought: ChatPartView = { kind: 'reasoning', id: 'p1', state: 'done' };
    const text: ChatPartView = { kind: 'text', id: 'p4', text: 'Because.' };
    const error: ChatPartView = { kind: 'error', id: 'p6', code: 'timeout', message: 'Late.' };
    expect(
      planMessageParts([
        thought,
        tool('p2', 'done'),
        tool('p3', 'failed'),
        text,
        tool('p5', 'running'),
        error,
      ]),
    ).toStrictEqual([
      {
        kind: 'steps',
        parts: [thought, tool('p2', 'done'), tool('p3', 'failed')],
        label: 'Thought · 2 tool calls (1 failed)',
      },
      { kind: 'part', part: text },
      { kind: 'steps', parts: [tool('p5', 'running')], label: '1 tool call' },
      { kind: 'part', part: error },
    ]);
    expect(planMessageParts([])).toStrictEqual([]);
    expect(planMessageParts([thought])).toMatchObject([{ label: 'Thought' }]);
  });
});
