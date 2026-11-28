import { describe } from 'vitest';

import type { LspTextEdit } from '#internal/lsp/lsp-protocol.ts';
import { positionEncodings } from '#internal/lsp/position-encodings.ts';
import { test } from '#testing/test.ts';

import { suggestionsFromTextEdits } from './suggestions-from-text-edits.ts';

describe('suggestionsFromTextEdits', () => {
  test.for([
    {
      name: 'a rename on two separate lines, as two suggestions',
      text: 'const retries = 3;\n\nuse(retries);\n',
      edits: [edit([0, 6, 0, 13], 'budget'), edit([2, 4, 2, 11], 'budget')],
      expected: [
        { startLine: 1, endLine: 1, replacement: 'const budget = 3;' },
        { startLine: 3, endLine: 3, replacement: 'use(budget);' },
      ],
    },
    {
      name: 'edits on neighboring lines, merged into one suggestion',
      text: 'let a = 1;\nf(a);\nkeep();\n',
      edits: [edit([1, 2, 1, 3], 'b'), edit([0, 4, 0, 5], 'b')],
      expected: [{ startLine: 1, endLine: 2, replacement: 'let b = 1;\nf(b);' }],
    },
    {
      name: 'two edits on one line, and an adjacent pair that touch end to start',
      text: 'f(a, a);\nab\n',
      edits: [
        edit([0, 2, 0, 3], 'x'),
        edit([0, 5, 0, 6], 'x'),
        edit([1, 0, 1, 1], 'c'),
        edit([1, 1, 1, 2], 'd'),
      ],
      expected: [{ startLine: 1, endLine: 2, replacement: 'f(x, x);\ncd' }],
    },
    {
      name: 'UTF-16 columns after an astral character',
      text: "const s = '😀'; let old = s;\n",
      edits: [edit([0, 20, 0, 23], 'nu')],
      expected: [{ startLine: 1, endLine: 1, replacement: "const s = '😀'; let nu = s;" }],
    },
    {
      name: 'UTF-8 columns after multi-byte characters',
      encoding: positionEncodings.utf8,
      text: "const é = '😀'; let old = 1;\n",
      edits: [edit([0, 23, 0, 26], 'nu')],
      expected: [{ startLine: 1, endLine: 1, replacement: "const é = '😀'; let nu = 1;" }],
    },
    {
      name: 'UTF-32 columns after an astral character',
      encoding: positionEncodings.utf32,
      text: "'😀'; old;\n",
      edits: [edit([0, 5, 0, 8], 'nu')],
      expected: [{ startLine: 1, endLine: 1, replacement: "'😀'; nu;" }],
    },
    {
      name: 'CRLF lines, whose `\\r` stays in the replacement',
      text: 'a = 1;\r\nb = a;\r\n',
      edits: [edit([0, 0, 0, 1], 'c'), edit([1, 4, 1, 5], 'c')],
      expected: [{ startLine: 1, endLine: 2, replacement: 'c = 1;\r\nb = c;\r' }],
    },
    {
      name: 'a lone `\\r` ending an LSP line inside one suggestion line',
      text: 'a\rb\n',
      edits: [edit([1, 0, 1, 1], 'c')],
      expected: [{ startLine: 1, endLine: 1, replacement: 'a\rc' }],
    },
    {
      name: 'an edit at the end of a line, its column past the end clamped',
      text: 'abc\nnext\n',
      edits: [edit([0, 3, 0, 99], 'd')],
      expected: [{ startLine: 1, endLine: 1, replacement: 'abcd' }],
    },
    {
      name: 'the last line, without a final newline',
      text: 'a\nfoo',
      edits: [edit([1, 0, 1, 3], 'bar')],
      expected: [{ startLine: 2, endLine: 2, replacement: 'bar' }],
    },
    {
      name: 'an inserted line, as an insertion',
      text: 'a\nb\n',
      edits: [edit([1, 0, 1, 0], 'x\n')],
      expected: [{ startLine: 2, endLine: 1, replacement: 'x' }],
    },
    {
      name: 'a line appended after the last one',
      text: 'a\n',
      edits: [edit([1, 0, 1, 0], 'b\n')],
      expected: [{ startLine: 2, endLine: 1, replacement: 'b' }],
    },
    {
      name: 'a removed line, as no lines',
      text: 'a\nb\nc\n',
      edits: [edit([1, 0, 2, 0], '')],
      expected: [{ startLine: 2, endLine: 2, replacement: '' }],
    },
    {
      name: 'a line emptied, taking the next line along',
      text: 'a\nfoo\nb\n',
      edits: [edit([1, 0, 1, 3], '')],
      expected: [{ startLine: 2, endLine: 3, replacement: '\nb' }],
    },
    {
      name: 'the last line emptied, taking the line before along',
      text: 'a\nfoo\n',
      edits: [edit([1, 0, 1, 3], '')],
      expected: [{ startLine: 1, endLine: 2, replacement: 'a\n' }],
    },
    {
      name: 'an edit that writes back what was there, as nothing',
      text: 'same\n',
      edits: [edit([0, 0, 0, 4], 'same')],
      expected: [],
    },
    {
      name: 'a multi-line edit trimmed to the lines it changes',
      text: 'a\nb\nc\n',
      edits: [edit([0, 0, 2, 1], 'a\nB\nc')],
      expected: [{ startLine: 2, endLine: 2, replacement: 'B' }],
    },
  ])('turns $name', ({ text, edits, expected, encoding }, { expect }) => {
    expect(
      suggestionsFromTextEdits({
        path: 'src/a.ts',
        text,
        edits,
        encoding: encoding ?? positionEncodings.utf16,
      }),
    ).toStrictEqual({
      ok: true,
      value: expected.map((suggestion) => {
        return { path: 'src/a.ts', ...suggestion };
      }),
    });
  });

  test.for([
    {
      name: 'overlapping edits',
      text: 'abcdef\n',
      edits: [edit([0, 0, 0, 3], 'x'), edit([0, 2, 0, 4], 'y')],
      reason: 'the edits overlap',
    },
    {
      name: 'an edit on a line the file lacks',
      text: 'a\n',
      edits: [edit([5, 0, 5, 1], 'x')],
      reason: 'an edit is past the end of the file',
    },
    {
      name: 'an edit that ends before it starts',
      text: 'abc\n',
      edits: [edit([0, 2, 0, 1], 'x')],
      reason: 'an edit ends before it starts',
    },
    {
      name: 'an edit that adds a final newline',
      text: 'a',
      edits: [edit([0, 1, 0, 1], '\n')],
      reason: 'the edits change its final newline',
    },
    {
      name: 'an edit that removes the final newline',
      text: 'a\nb\n',
      edits: [edit([1, 1, 2, 0], '')],
      reason: 'the edits change its final newline',
    },
  ])('refuses $name', ({ text, edits, reason }, { expect }) => {
    expect(
      suggestionsFromTextEdits({
        path: 'src/a.ts',
        text,
        edits,
        encoding: positionEncodings.utf16,
      }),
    ).toStrictEqual({ ok: false, error: reason });
  });
});

/** An edit of `[startLine, startCharacter, endLine, endCharacter]`, 0-based. */
function edit(
  [startLine, startCharacter, endLine, endCharacter]: readonly [number, number, number, number],
  newText: string,
): LspTextEdit {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
    newText,
  };
}
