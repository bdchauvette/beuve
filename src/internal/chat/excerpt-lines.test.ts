import { describe } from 'vitest';

import { excerptLines } from './excerpt-lines.ts';
import { test } from './testing/test.ts';

describe('excerptLines', () => {
  const text = 'one\ntwo\r\nthree\nfour\n';

  test('cuts 1-based inclusive lines without their terminators', ({ expect }) => {
    expect(excerptLines(text, { startLine: 2, endLine: 3 })).toStrictEqual({
      ok: true,
      value: {
        startLine: 2,
        endLine: 3,
        totalLines: 4,
        isWholeFile: false,
        lines: ['two', 'three'],
      },
    });
  });

  test('takes the whole file without lines, and clamps an end past the last line', ({ expect }) => {
    expect(excerptLines(text)).toMatchObject({
      ok: true,
      value: {
        startLine: 1,
        endLine: 4,
        isWholeFile: true,
        lines: ['one', 'two', 'three', 'four'],
      },
    });
    expect(excerptLines(text, { startLine: 1, endLine: 99 })).toMatchObject({
      ok: true,
      value: { endLine: 4, isWholeFile: true },
    });
    expect(excerptLines('', { startLine: undefined, endLine: undefined })).toMatchObject({
      ok: true,
      value: { totalLines: 0, lines: [] },
    });
  });

  test('refuses a start past the end', ({ expect }) => {
    expect(excerptLines(text, { startLine: 5, endLine: 6 })).toStrictEqual({
      ok: false,
      error: { kind: 'beyond-end', totalLines: 4 },
    });
  });
});
