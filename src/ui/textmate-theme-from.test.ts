import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { syntaxPalettes } from './syntax-palettes.ts';
import { textmateThemeFrom } from './textmate-theme-from.ts';

function fontStyles(): RegExp {
  return /fontStyle|bold|italic/u;
}

describe('textmateThemeFrom', () => {
  test('uses only the palette, and no bold or italics', ({ expect }) => {
    const light = syntaxPalettes.light;
    const theme = textmateThemeFrom('t', 'light', light);
    expect(theme).toMatchObject({
      name: 't',
      type: 'light',
      fg: light.foreground,
      bg: light.background,
    });
    const colors = new Set(theme.tokenColors.map((rule) => rule.settings.foreground));
    expect(colors).toStrictEqual(
      new Set([
        light.comment,
        light.string,
        light.constant,
        light.definition,
        light.muted,
        light.foreground,
      ]),
    );
    expect(JSON.stringify(theme)).not.toMatch(fontStyles());
  });
});

describe('textmateThemeFrom through Shiki (as the diff view highlights)', () => {
  test('mutes keywords, operators and punctuation and leaves names plain in TypeScript', ({
    expect,
    colorsOf,
  }) => {
    const {
      foreground: plain,
      muted,
      comment,
      string,
      constant,
      definition,
    } = syntaxPalettes.light;
    const code = [
      '«// why»',
      '«export» «function» «build»«(»«items»«:» «readonly» «Item»«[]»«)»«:» «Widget» «{»',
      "  «const» «w» «=» «new» «Widget»«(»«'x'», «42», «true», «null»«)»«;»",
      '  «if» «(»«w»«)» «{» «return» «w».«render»«(»`«a»«${»«items».length «+» «1»«}»`«)»«;» «}»',
      '«}»',
      'export class «Widget» {}',
      'interface «Item» { id: string }',
      'export const «handler» = (): void => {};',
    ].join('\n');
    const lines = [
      [comment],
      [muted, muted, definition, muted, plain, muted, muted, plain, muted, muted, muted, plain],
      [muted],
      [muted, plain, muted, muted, plain, muted, string, constant, constant, constant, muted],
      [muted],
      [muted, muted, plain, muted, muted, muted, plain, plain, muted, string, muted, plain],
      [muted, constant, muted, muted, muted, muted],
      [muted],
      [definition],
      [definition],
      [definition],
    ];
    expect(colorsOf('typescript', code)).toStrictEqual(lines.flat());
  });

  test('keeps what a comment or string holds in its color', ({ expect, colorsOf }) => {
    const { comment, string } = syntaxPalettes.light;
    const code = "/** «@param» «{»«Item»«}» items */\nconst r = «/»a«+»«(»b«)?»/u, q = «'»a«'»;";
    const lines = [
      [comment, comment, comment, comment],
      [string, string, string, string, string, string],
    ];
    expect(colorsOf('typescript', code)).toStrictEqual(lines.flat());
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

  test('leaves built-in type names plain, as in TypeScript', ({ expect, colorsOf }) => {
    const { foreground: plain, muted } = syntaxPalettes.light;
    expect(colorsOf('go', '«var» a «int»; var e «error»')).toStrictEqual([muted, plain, plain]);
    expect(colorsOf('rust', '«let» a: «i32» = 1;')).toStrictEqual([muted, plain]);
    expect(colorsOf('typescript', '«let» a: «number» = 1;')).toStrictEqual([muted, plain]);
  });
});
