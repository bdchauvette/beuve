import { describe } from 'vitest';

import { parseNoteProposals } from './parse-note-proposals.ts';
import { test } from './testing/test.ts';

describe('parseNoteProposals', () => {
  test('splits an answer at its blocks, with label, lines, title and body', ({ expect }) => {
    const answer = [
      'Two things.',
      '',
      ':::note issue [[src/a.ts:12-13]] Empty input is not handled',
      'An empty string yields `undefined`.',
      '',
      ':::',
      'And:',
      ':::note\tnitpick (non-blocking) [[./src/b.ts:2]]',
      'Name it `one`.',
      ':::  ',
      'Done.',
    ].join('\n');
    expect(parseNoteProposals(answer)).toStrictEqual([
      { kind: 'text', text: 'Two things.\n\n' },
      {
        kind: 'block',
        label: 'issue',
        blocking: false,
        lines: { path: 'src/a.ts', startLine: 12, endLine: 13 },
        title: 'Empty input is not handled',
        body: 'An empty string yields `undefined`.',
      },
      { kind: 'text', text: 'And:\n' },
      {
        kind: 'block',
        label: 'nitpick',
        blocking: false,
        lines: { path: 'src/b.ts', startLine: 2, endLine: 2 },
        title: '',
        body: 'Name it `one`.',
      },
      { kind: 'text', text: 'Done.' },
    ]);
  });

  test('keeps a fenced block in the body, closing `:::` lines inside it included', ({ expect }) => {
    const answer = [':::note question [[src/a.ts:12]] Why?', '````md', ':::', '````', ':::'].join(
      '\n',
    );
    expect(parseNoteProposals(answer)).toMatchObject([
      { kind: 'block', title: 'Why?', body: '````md\n:::\n````' },
    ]);
  });

  test('leaves `:::note` inside code, indented or mid-line as text', ({ expect }) => {
    const answers = [
      '```\n:::note issue [[src/a.ts:12]] x\n:::\n```\n',
      '  :::note issue [[src/a.ts:12]] x\n:::\n',
      'See :::note issue [[src/a.ts:12]] x\n:::\n',
      ':::notes are fine\n',
    ];
    for (const answer of answers) {
      expect(parseNoteProposals(answer)).toStrictEqual([{ kind: 'text', text: answer }]);
    }
  });

  test.for<[string, string]>([
    ['no label', ':::note [[src/a.ts:12]] x\nbody\n:::'],
    ['no anchor', ':::note issue x\nbody\n:::'],
    ['an anchor without lines', ':::note issue [[src/a.ts]] x\nbody\n:::'],
    ['a backwards range', ':::note issue [[src/a.ts:9-3]]\nbody\n:::'],
    ['an uppercase label', ':::note Issue [[src/a.ts:12]]\nbody\n:::'],
    ['text glued to the anchor', ':::note issue [[src/a.ts:12]]x\nbody\n:::'],
    ['a bare keyword', ':::note\nbody\n:::'],
    ['an unknown decoration', ':::note issue (if-minor) [[src/a.ts:12]]\nbody\n:::'],
    ['a glued decoration', ':::note issue (blocking)[[src/a.ts:12]]\nbody\n:::'],
    ['a decoration after the anchor', ':::note issue [[src/a.ts:12]](blocking)\nbody\n:::'],
  ])('drops a block with %s as malformed', ([, answer], { expect }) => {
    expect(parseNoteProposals(`Before.\n${answer}\nAfter.`)).toStrictEqual([
      { kind: 'text', text: 'Before.\n' },
      { kind: 'malformed' },
      { kind: 'text', text: 'After.' },
    ]);
  });

  test('keeps an unclosed block as text and counts it malformed', ({ expect }) => {
    expect(parseNoteProposals('Hi.\n:::note issue [[src/a.ts:12]] x\nbody\n')).toStrictEqual([
      { kind: 'text', text: 'Hi.\n' },
      { kind: 'malformed' },
      { kind: 'text', text: ':::note issue [[src/a.ts:12]] x\nbody\n' },
    ]);
  });

  test('reads the blocking decoration and CRLF line endings', ({ expect }) => {
    expect(
      parseNoteProposals(':::note todo (blocking)\t[[src/a.ts:12]] T\r\nB\r\n:::\r\n'),
    ).toStrictEqual([
      {
        kind: 'block',
        label: 'todo',
        blocking: true,
        lines: { path: 'src/a.ts', startLine: 12, endLine: 12 },
        title: 'T',
        body: 'B',
      },
    ]);
  });
});
