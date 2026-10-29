import { describe, expect, it } from 'vitest';

import { excerptLines } from './excerpt-lines.ts';

describe('excerptLines', () => {
  const text = 'one\ntwo\r\nthree\nfour\n';

  it('cuts 1-based inclusive lines without their terminators', () => {
    expect(excerptLines(text, 2, 3)).toEqual({
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

  it('takes the whole file without lines, and clamps an end past the last line', () => {
    expect(excerptLines(text)).toMatchObject({
      ok: true,
      value: {
        startLine: 1,
        endLine: 4,
        isWholeFile: true,
        lines: ['one', 'two', 'three', 'four'],
      },
    });
    expect(excerptLines(text, 1, 99)).toMatchObject({
      ok: true,
      value: { endLine: 4, isWholeFile: true },
    });
    expect(excerptLines('', undefined, undefined)).toMatchObject({
      ok: true,
      value: { totalLines: 0, lines: [] },
    });
  });

  it('refuses a start past the end', () => {
    expect(excerptLines(text, 5, 6)).toEqual({
      ok: false,
      error: { kind: 'beyond-end', totalLines: 4 },
    });
  });
});
