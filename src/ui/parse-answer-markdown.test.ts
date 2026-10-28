import { describe, expect, it } from 'vitest';

import type { ChatCitationView } from '#contract/ipc-contract.ts';

import { parseAnswerMarkdown } from './parse-answer-markdown.ts';

const a: ChatCitationView = { path: 'src/a.ts', startLine: 12, endLine: 13 };
const snake: ChatCitationView = { path: 'src/my_file_name.ts', startLine: 3, endLine: 3 };

describe('parseAnswerMarkdown', () => {
  it('turns exactly the listed markers of a final answer into citation spans', () => {
    const blocks = parseAnswerMarkdown(
      'It trims [[src/a.ts:12-13]] but not [[src/a.ts:1-2]] or [[nope]].',
      [a],
      'final',
    );
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'It trims ' },
          { kind: 'citation', citation: a },
          { kind: 'text', text: ' but not [[src/a.ts:1-2]] or [[nope]].' },
        ],
      },
    ]);
  });

  it('keeps underscores in a cited path from becoming emphasis', () => {
    const [block] = parseAnswerMarkdown(
      'See _this_ and [[src/my_file_name.ts:3-3]] and _that_.',
      [snake],
      'final',
    );
    expect(block).toEqual({
      kind: 'paragraph',
      spans: [
        { kind: 'text', text: 'See ' },
        { kind: 'emphasis', text: 'this' },
        { kind: 'text', text: ' and ' },
        { kind: 'citation', citation: snake },
        { kind: 'text', text: ' and ' },
        { kind: 'emphasis', text: 'that' },
        { kind: 'text', text: '.' },
      ],
    });
  });

  it('leaves markers in code and in emphasis literal, in blocks, lists and fences', () => {
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
      [a],
      'final',
    );
    expect(blocks).toEqual([
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
            { kind: 'citation', citation: a },
          ],
        ],
      },
      { kind: 'code', text: marker },
    ]);
  });

  it('dims every well-formed marker of a streaming answer and hides one still being written', () => {
    expect(
      parseAnswerMarkdown('Look at [[src/zzz.ts:1-1]] and [[src/a.ts:1', [a], 'streaming'),
    ).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'Look at ' },
          { kind: 'marker', text: '[[src/zzz.ts:1-1]]' },
          { kind: 'text', text: ' and' },
        ],
      },
    ]);
    expect(parseAnswerMarkdown('ends with [[', [], 'streaming')).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'ends with' }] },
    ]);
  });

  it('never lets model text forge a placeholder', () => {
    const blocks = parseAnswerMarkdown('x 0 y [[src/a.ts:12-13]]', [a], 'final');
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { kind: 'text', text: 'x 0 y ' },
          { kind: 'citation', citation: a },
        ],
      },
    ]);
  });
});
