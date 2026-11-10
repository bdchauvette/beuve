import { describe } from 'vitest';

import { chatTextFrom } from './chat-text-from.ts';
import { test } from './testing/test.ts';

describe('chatTextFrom', () => {
  test('joins text parts and names mentions by their chip labels', ({ expect }) => {
    expect(
      chatTextFrom([
        { kind: 'text', id: 'p1', text: 'Why ' },
        {
          kind: 'mention',
          id: 'p2',
          mention: {
            path: 'src/a.ts',
            side: 'head',
            startLine: 2,
            endLine: 3,
            sha: 'c'.repeat(40),
          },
        },
        { kind: 'text', id: 'p3', text: '?' },
        { kind: 'tool-call', id: 'p4', tool: 'Read', description: 'read a.ts', state: 'done' },
        { kind: 'error', id: 'p5', code: 'timeout', message: 'Timed out.' },
      ]),
    ).toBe('Why a.ts:2-3?');
  });

  test('leaves proposed notes out, keeping the text around them apart', ({ expect }) => {
    const note = {
      path: 'a.ts',
      startLine: 1,
      endLine: 1,
      label: 'nitpick' as const,
      blocking: false,
      title: 'T',
      body: 'B',
    };
    expect(
      chatTextFrom([
        { kind: 'text', id: 'p1', text: 'Before.' },
        { kind: 'proposal', id: 'p2', proposal: 0, note },
        { kind: 'text', id: 'p3', text: 'After.' },
      ]).trim(),
    ).toBe('Before.\n\nAfter.');
  });
});
