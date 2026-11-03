import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { planDefinitionProbes } from './plan-definition-probes.ts';

function textsOf(text: string, character?: number): readonly string[] {
  return planDefinitionProbes(text, character).map((token) => token.text);
}

describe('planDefinitionProbes', () => {
  test('puts calls first, declared names last and leaves keywords out', ({ expect }) => {
    expect(textsOf('  return c(n) + 1;')).toStrictEqual(['c', 'n']);
    expect(textsOf('const total = await repo.read<Blob>(path);')).toStrictEqual([
      'read',
      'repo',
      'Blob',
      'path',
      'total',
    ]);
    expect(textsOf('export function b(n: number): number {')).toStrictEqual([
      'n',
      'number',
      'number',
      'b',
    ]);
  });

  test('ignores strings and comments', ({ expect }) => {
    expect(textsOf("log('call(me)', value); // later(x)")).toStrictEqual(['log', 'value']);
    expect(textsOf('const s = `a ${b}` + "it\\"s"; /* c(d) */')).toStrictEqual(['s']);
  });

  test('takes the identifier under a known column, with UTF-16 columns', ({ expect }) => {
    const line = "const label = '😀'; wide(label);";
    expect(planDefinitionProbes(line, line.indexOf('wide') + 2)).toStrictEqual([
      { start: line.indexOf('wide'), end: line.indexOf('wide') + 4, text: 'wide' },
    ]);
    expect(textsOf(line, line.indexOf('label);') + 5)).toStrictEqual(['label']);
    expect(textsOf('a + b', 2)).toStrictEqual(['a', 'b']);
  });

  test('plans nothing for a blank line and at most six tokens', ({ expect }) => {
    expect(planDefinitionProbes(' '.repeat(3))).toStrictEqual([]);
    expect(textsOf('a b c d e f g h')).toHaveLength(6);
  });

  test('plans a link probe for the identifier the pointer is on, never a keyword or a neighbour', ({
    expect,
  }) => {
    const line = '  return validate(token) ? 200 : 401;';
    const linkTexts = (character: number): string[] => {
      return planDefinitionProbes(line, character, { link: true }).map((token) => token.text);
    };
    expect(linkTexts(9)).toStrictEqual(['validate']);
    expect(linkTexts(16)).toStrictEqual(['validate']);
    expect(linkTexts(17)).toStrictEqual([]);
    expect(linkTexts(4)).toStrictEqual([]);
    expect(linkTexts(0)).toStrictEqual([]);
    expect(planDefinitionProbes(line, undefined, { link: true })).toStrictEqual([]);
  });
});
