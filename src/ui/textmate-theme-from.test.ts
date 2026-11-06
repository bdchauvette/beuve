import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { syntaxPalettes } from './syntax-palettes.ts';
import { textmateThemeFrom } from './textmate-theme-from.ts';

describe('textmateThemeFrom', () => {
  test('colors only with the palette', ({ expect }) => {
    const light = syntaxPalettes.light;
    const theme = textmateThemeFrom('t', 'light', light);
    expect(theme).toMatchObject({
      name: 't',
      type: 'light',
      fg: light.foreground,
      bg: light.background,
    });
    const colors = new Set(theme.tokenColors.map((rule) => rule.settings.foreground));
    expect(colors).toStrictEqual(new Set([light.foreground, light.muted, light.comment]));
  });
});

describe('textmateThemeFrom through Shiki (as the diff view highlights)', () => {
  test('bolds names, italicises types and mutes keywords and punctuation in TypeScript', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«// why»',
      '«export» «function» «build»«(»«items»«:» «readonly» «Item»«[]»«)»«:» «Map»«<»«string»«,» «Widget»«>» «{»',
      "  «const» «w» «=» «new» «Widget»«(»«'x'», «42», «true», «null»«)»«;»",
      '  «if» «(»«w» «||» «!»«items»«)» «{» «return» «w».«render»«(»`«a»«${»«items».«length» «+» «1»«}»`«)»«;» «}»',
      '«}»',
      '«type» «Kind» «=» «A» «|» «B»;',
      '«class» «Widget» «extends» «Base» «implements» «Labelled» {}',
      'const «handler» = «async» «(»«)»«:» «void» «=>» {};',
    ].join('\n');
    const lines = [
      ['comment'],
      ['muted', 'muted', 'name', 'muted', 'name', 'muted', 'muted', 'type', 'muted', 'muted'],
      ['muted', 'type', 'muted', 'type', 'muted', 'type', 'muted', 'muted'],
      ['muted', 'name', 'plain', 'muted', 'name', 'muted', 'plain', 'plain', 'plain', 'plain'],
      ['muted', 'muted'],
      ['muted', 'muted', 'name', 'plain', 'plain', 'name', 'muted', 'muted', 'muted', 'name'],
      ['name', 'muted', 'plain', 'muted', 'name', 'name', 'plain', 'plain', 'muted', 'muted'],
      ['muted', 'muted'],
      ['muted'],
      ['muted', 'type', 'plain', 'type', 'plain', 'type'],
      ['muted', 'type', 'muted', 'type', 'muted', 'type'],
      ['name', 'muted', 'muted', 'muted', 'muted', 'type', 'muted'],
    ];
    expect(stylesOf('typescript', code)).toStrictEqual(lines.flat());
  });

  test('keeps what a comment or string holds in its style', ({ expect, stylesOf }) => {
    const code = "/** «@param» «{»«Item»«}» items */\nconst r = «/»a«+»«(»b«)?»/u, q = «'»a«'»;";
    const lines = [
      ['comment', 'comment', 'comment', 'comment'],
      ['plain', 'plain', 'plain', 'plain', 'plain', 'plain'],
    ];
    expect(stylesOf('typescript', code)).toStrictEqual(lines.flat());
  });

  test('bolds names in Go, Rust, Python and shell, scoped or not, and interpolated', ({
    expect,
    stylesOf,
  }) => {
    const go = '«func» «helper»«(»«a» «int»«)» «{» «return» «a»«.»«Value» «}»';
    expect(stylesOf('go', go)).toStrictEqual([
      'muted',
      'name',
      'muted',
      'name',
      'type',
      'muted',
      'muted',
      'muted',
      'name',
      'muted',
      'name',
      'muted',
    ]);
    const rust = '«fn» «f»«(»«x»«:» «i32»«)» «{» «x»«.»«value» «}»';
    expect(stylesOf('rust', rust)).toStrictEqual([
      'muted',
      'name',
      'muted',
      'name',
      'muted',
      'type',
      'muted',
      'muted',
      'name',
      'muted',
      'name',
      'muted',
    ]);
    const python = '«w» «=» «build»«(»«items»«)»\n«return» «w»«.»«value»';
    expect(stylesOf('python', python)).toStrictEqual([
      'name',
      'plain',
      'name',
      'muted',
      'name',
      'muted',
      'muted',
      'name',
      'muted',
      'name',
    ]);
    const shell = '«name»«=»«"»«$1»«"»\n«grep» «-q» «foo»';
    expect(stylesOf('shellscript', shell)).toStrictEqual([
      'name',
      'plain',
      'plain',
      'name',
      'plain',
      'name',
      'plain',
      'plain',
    ]);
  });

  test('italicises Python annotations, which the grammar leaves unscoped', ({
    expect,
    stylesOf,
  }) => {
    const code =
      '«def» «build»«(»«items»«:» «list»«[»«Item»«]»«)» «->» «Widget»«:»\n    «return» «Widget»«(»«)»';
    const lines = [
      [
        'muted',
        'name',
        'muted',
        'name',
        'muted',
        'type',
        'muted',
        'type',
        'muted',
        'muted',
        'muted',
      ],
      ['type', 'muted'],
      ['muted', 'name', 'muted', 'muted'],
    ];
    expect(stylesOf('python', code)).toStrictEqual(lines.flat());
  });

  test('bolds Markdown headings and leaves prose regular', ({ expect, stylesOf }) => {
    expect(stylesOf('markdown', '# «Title»\n«Some» prose.')).toStrictEqual(['name', 'plain']);
  });
});
