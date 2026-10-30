import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatCitationView } from '#contract/ipc-contract.ts';

import { parseAnswerMarkdown } from './parse-answer-markdown.ts';

function a(): ChatCitationView {
  return { path: 'src/a.ts', startLine: 12, endLine: 13 };
}
function snake(): ChatCitationView {
  return { path: 'src/my_file_name.ts', startLine: 3, endLine: 3 };
}

describe('parseAnswerMarkdown', () => {
  test('turns exactly the listed markers of a final answer into citation spans', ({ expect }) => {
    const blocks = parseAnswerMarkdown(
      'It trims [[src/a.ts:12-13]] but not [[src/a.ts:1-2]] or [[nope]].',
      [a()],
      'final',
    );
    expect(blocks).toStrictEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'It trims ' },
          { kind: 'citation', citation: a() },
          { kind: 'text', text: ' but not [[src/a.ts:1-2]] or [[nope]].' },
        ],
      },
    ]);
  });

  test('keeps underscores in a cited path from becoming emphasis', ({ expect }) => {
    const [block] = parseAnswerMarkdown(
      'See _this_ and [[src/my_file_name.ts:3-3]] and _that_.',
      [snake()],
      'final',
    );
    expect(block).toStrictEqual({
      kind: 'paragraph',
      spans: [
        { kind: 'text', text: 'See ' },
        { kind: 'emphasis', text: 'this' },
        { kind: 'text', text: ' and ' },
        { kind: 'citation', citation: snake() },
        { kind: 'text', text: ' and ' },
        { kind: 'emphasis', text: 'that' },
        { kind: 'text', text: '.' },
      ],
    });
  });

  test('leaves markers in code and in emphasis literal, in blocks, lists and fences', ({
    expect,
  }) => {
    const marker = '[[src/a.ts:12-13]]';
    const blocks = parseAnswerMarkdown(
      [
        `Use \`${marker}\` or **${marker}**.`,
        '',
        `- item ${marker}`,
        '',
        '```',
        marker,
        '```',
      ].join('\n'),
      [a()],
      'final',
    );
    expect(blocks).toStrictEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'Use ' },
          { kind: 'code', text: marker },
          { kind: 'text', text: ' or ' },
          { kind: 'strong', text: marker },
          { kind: 'text', text: '.' },
        ],
      },
      {
        kind: 'list',
        items: [
          [
            { kind: 'text', text: 'item ' },
            { kind: 'citation', citation: a() },
          ],
        ],
      },
      { kind: 'code', text: marker },
    ]);
  });

  test('dims every well-formed marker of a streaming answer and hides one still being written', ({
    expect,
  }) => {
    expect(
      parseAnswerMarkdown('Look at [[src/zzz.ts:1-1]] and [[src/a.ts:1', [a()], 'streaming'),
    ).toStrictEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'Look at ' },
          { kind: 'marker', text: '[[src/zzz.ts:1-1]]' },
          { kind: 'text', text: ' and' },
        ],
      },
    ]);
    expect(parseAnswerMarkdown('ends with [[', [], 'streaming')).toStrictEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'ends with' }] },
    ]);
  });

  test('never lets model text forge a placeholder', ({ expect }) => {
    const blocks = parseAnswerMarkdown('x 0 y [[src/a.ts:12-13]]', [a()], 'final');
    expect(blocks).toStrictEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'x 0 y ' },
          { kind: 'citation', citation: a() },
        ],
      },
    ]);
  });
});
