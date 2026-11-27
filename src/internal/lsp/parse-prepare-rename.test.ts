import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parsePrepareRename } from './parse-prepare-rename.ts';

describe('parsePrepareRename', () => {
  const range = { start: { line: 3, character: 4 }, end: { line: 3, character: 9 } };

  test.for([
    ['a bare range', range, { kind: 'range', range, placeholder: undefined }],
    [
      'a range with a placeholder',
      { range, placeholder: 'retry' },
      { kind: 'range', range, placeholder: 'retry' },
    ],
    [
      'a placeholder that is no string',
      { range, placeholder: 7 },
      { kind: 'range', range, placeholder: undefined },
    ],
    [
      'an overlong placeholder',
      { range, placeholder: 'x'.repeat(1025) },
      { kind: 'range', range, placeholder: undefined },
    ],
    ['the default behavior', { defaultBehavior: true }, { kind: 'default' }],
    ['null', JSON.parse('null'), { kind: 'refused' }],
    ['a malformed range', { range: { start: 1 } }, { kind: 'refused' }],
    ['a false default behavior', { defaultBehavior: false }, { kind: 'refused' }],
  ] as const)('reads %s', ([, value, expected], { expect }) => {
    expect(parsePrepareRename(value)).toStrictEqual(expected);
  });
});
