import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { syntaxPalettes } from './syntax-palettes.ts';
import { toTextmateTheme } from './to-textmate-theme.ts';

function styledScope(): RegExp {
  return /keyword|punctuation(?!\.definition\.comment)|storage|operator/u;
}
function fontStyles(): RegExp {
  return /fontStyle|bold|italic/u;
}

describe('toTextmateTheme', () => {
  test('colors only comments, strings, constants and definitions', ({ expect }) => {
    const light = syntaxPalettes.light;
    const theme = toTextmateTheme('t', 'light', light);
    expect(theme).toMatchObject({ name: 't', type: 'light', fg: '#000000', bg: '#f7f7f7' });
    const colors = new Set(theme.tokenColors.map((rule) => rule.settings.foreground));
    expect(colors).toStrictEqual(
      new Set([light.comment, light.string, light.constant, light.definition, light.foreground]),
    );
    const scopes = theme.tokenColors.flatMap((rule) => rule.scope);
    expect(scopes.filter((scope) => styledScope().test(scope))).toStrictEqual([]);
    expect(JSON.stringify(theme)).not.toMatch(fontStyles());
  });
});

describe('toTextmateTheme through Shiki (as the diff view highlights)', () => {
  test('leaves keywords, operators, punctuation, calls and type references plain in TypeScript', ({
    expect,
    colorsOf,
  }) => {
    const { foreground: plain, comment, string, constant, definition } = syntaxPalettes.light;
    const code = [
      '«// why»',
      '«export» «function» «build»«(»items: readonly «Item»[]): «Widget» {',
      "  «const» w «=» «new» «Widget»(«'x'», «42», «true», «null»);",
      '  «return» w.«render»(`«a»${«items».length}`);',
      '}',
      'export class «Widget» {}',
      'interface «Item» { id: string }',
      'export const «handler» = (): void => {};',
    ].join('\n');
    expect(colorsOf('typescript', code)).toStrictEqual([
      comment,
      plain,
      plain,
      definition,
      plain,
      plain,
      plain,
      plain,
      plain,
      plain,
      plain,
      string,
      constant,
      constant,
      constant,
      plain,
      plain,
      string,
      plain,
      definition,
      definition,
      definition,
    ]);
  });

  test('colors definitions but not calls in Go, Rust, Python and shell', ({ expect, colorsOf }) => {
    const { foreground: plain, definition } = syntaxPalettes.light;
    expect(colorsOf('go', 'func «helper»() {}\nfunc main() { «helper»() }')).toStrictEqual([
      definition,
      plain,
    ]);
    expect(colorsOf('rust', 'fn «helper»() {}\nfn main() { «helper»(); }')).toStrictEqual([
      definition,
      plain,
    ]);
    expect(colorsOf('python', 'def «build»():\n    return «build»()')).toStrictEqual([
      definition,
      plain,
    ]);
    expect(colorsOf('shellscript', '«build»() { :; }\n«build»\n«make» all')).toStrictEqual([
      definition,
      plain,
      plain,
    ]);
  });
});
