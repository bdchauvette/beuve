import { describe, expect, it } from 'vitest';

import { parseNumstat } from './parse-numstat.ts';

describe('parseNumstat', () => {
  it('parses text, binary and renamed entries from -z output', () => {
    const output = [
      '3\t0\t.gitmodules',
      '-\t-\tblob.bin',
      '1\t0\t',
      'old-name.txt',
      'new name ü.txt',
      '1\t0\ttab\there.txt',
      '',
    ].join('\0');
    expect(parseNumstat(output)).toEqual([
      {
        path: '.gitmodules',
        previousPath: undefined,
        stats: { kind: 'text', added: 3, removed: 0 },
      },
      { path: 'blob.bin', previousPath: undefined, stats: { kind: 'binary' } },
      {
        path: 'new name ü.txt',
        previousPath: 'old-name.txt',
        stats: { kind: 'text', added: 1, removed: 0 },
      },
      {
        path: 'tab\there.txt',
        previousPath: undefined,
        stats: { kind: 'text', added: 1, removed: 0 },
      },
    ]);
  });

  it('returns nothing for an empty diff and undefined for garbage', () => {
    expect(parseNumstat('')).toEqual([]);
    expect(parseNumstat('nonsense\0')).toBeUndefined();
    expect(parseNumstat('1\t2\t\0only-one\0')).toBeUndefined();
  });
});
