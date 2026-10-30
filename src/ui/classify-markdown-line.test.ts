import { describe } from 'vitest';

import { classifyMarkdownLine } from './classify-markdown-line.ts';
import type { MarkdownLine } from './classify-markdown-line.ts';
import { test } from './testing/test.ts';

describe('classifyMarkdownLine', () => {
  test.for<[string, MarkdownLine]>([
    ['', { kind: 'blank' }],
    [' \t ', { kind: 'blank' }],
    ['```ts title', { kind: 'fence', indent: 0, fence: '```', info: 'ts title' }],
    ['  ~~~~', { kind: 'fence', indent: 2, fence: '~~~~', info: '' }],
    ['``` a`b', { kind: 'text', indent: 0, text: '``` a`b' }],
    ['    ```', { kind: 'text', indent: 4, text: '```' }],
    ['## Title ##', { kind: 'heading', indent: 0, level: 2, text: 'Title' }],
    ['#', { kind: 'heading', indent: 0, level: 1, text: '' }],
    ['# C#', { kind: 'heading', indent: 0, level: 1, text: 'C#' }],
    ['####### seven', { kind: 'text', indent: 0, text: '####### seven' }],
    [' - - -', { kind: 'rule', indent: 1 }],
    ['__ _', { kind: 'rule', indent: 0 }],
    ['--', { kind: 'text', indent: 0, text: '--' }],
    ['> quoted', { kind: 'quote', indent: 0, text: 'quoted' }],
    ['>no space', { kind: 'quote', indent: 0, text: 'no space' }],
    ['- item', { kind: 'item', indent: 0, marker: '-', contentIndent: 2, text: 'item' }],
    ['  *   wide', { kind: 'item', indent: 2, marker: '*', contentIndent: 6, text: 'wide' }],
    [
      '-      very wide',
      { kind: 'item', indent: 0, marker: '-', contentIndent: 2, text: 'very wide' },
    ],
    ['-', { kind: 'item', indent: 0, marker: '-', contentIndent: 2, text: '' }],
    [
      '12. twelve',
      { kind: 'item', indent: 0, marker: '.', start: 12, contentIndent: 4, text: 'twelve' },
    ],
    ['1) one', { kind: 'item', indent: 0, marker: ')', start: 1, contentIndent: 3, text: 'one' }],
    ['\t- tab', { kind: 'item', indent: 4, marker: '-', contentIndent: 6, text: 'tab' }],
    ['**bold** start', { kind: 'text', indent: 0, text: '**bold** start' }],
    ['1.5 apples', { kind: 'text', indent: 0, text: '1.5 apples' }],
    ['-1 degrees', { kind: 'text', indent: 0, text: '-1 degrees' }],
  ])('%j', ([line, expected], { expect }) => {
    expect(classifyMarkdownLine(line)).toStrictEqual(expected);
  });
});
