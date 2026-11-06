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
  test('bolds definitions and numbers, italicises types and mutes keywords in TypeScript', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«// why»',
      '«export» «function» «build»«(»«items»«:» «readonly» «Item»«[]»«)»«:» «Map»«<»«string»«,» «Widget»«>» «{»',
      "  «const» «w» «=» «new» «Widget»«(»«{» «label»«:» «'x'», «depth»«:» «42», «open»«:» «true» «}»«)»«;»",
      '  «if» «(»«w» «||» «!»«items»«)» «{» «return» «w».«render»«(»`«a»«${»«items».«length» «+» «1»«}»`«)»«;» «}»',
      '«}»',
      '«type» «Kind» «=» «A» «|» «B»;',
      '«class» «Widget» «extends» «Base» «implements» «Labelled» {}',
      '«interface» «Item» { «id»«:» «string» }',
      'const «handler» = «async» «(»«)»«:» «void» «=>» {};',
    ].join('\n');
    const lines = [
      ['comment'],
      ['muted', 'muted', 'bold', 'muted', 'plain', 'muted', 'muted', 'italic', 'muted', 'muted'],
      ['muted', 'italic', 'muted', 'italic', 'muted', 'italic', 'muted', 'muted'],
      ['muted', 'plain', 'plain', 'muted', 'plain', 'muted', 'muted', 'plain', 'muted', 'plain'],
      ['plain', 'muted', 'bold', 'plain', 'muted', 'plain', 'muted', 'muted', 'muted'],
      ['muted', 'muted', 'plain', 'plain', 'plain', 'plain', 'muted', 'muted', 'muted', 'plain'],
      ['plain', 'muted', 'plain', 'muted', 'plain', 'plain', 'plain', 'bold', 'muted', 'muted'],
      ['muted', 'muted'],
      ['muted'],
      ['muted', 'bold-italic', 'plain', 'italic', 'plain', 'italic'],
      ['muted', 'bold-italic', 'muted', 'italic', 'muted', 'italic'],
      ['muted', 'bold-italic', 'plain', 'muted', 'italic'],
      ['bold', 'muted', 'muted', 'muted', 'muted', 'italic', 'muted'],
    ];
    expect(stylesOf('typescript', code)).toStrictEqual(lines.flat());
  });

  test('keeps what a comment or string holds in its style', ({ expect, stylesOf }) => {
    const code = "/** «@param» «{»«Item»«}» «1» */\nconst r = «/»a«+»«(»b«)?»/u, q = «'»a«'»;";
    const lines = [
      ['comment', 'comment', 'comment', 'comment', 'comment'],
      ['plain', 'plain', 'plain', 'plain', 'plain', 'plain'],
    ];
    expect(stylesOf('typescript', code)).toStrictEqual(lines.flat());
  });

  test('styles Python, Go, Rust and shell the same way', ({ expect, stylesOf }) => {
    const python = [
      '«def» «build»«(»«items»«:» «list»«[»«Item»«]»«,» «n»«=»«3»«)» «->» «Widget»«:»',
      '    «return» «Widget»«(»«items»«.»«key»«)»',
      '«class» «Widget»«:» «pass»',
    ].join('\n');
    const pythonLines = [
      ['muted', 'bold', 'muted', 'plain', 'muted', 'italic', 'muted', 'italic', 'muted', 'muted'],
      ['plain', 'plain', 'bold', 'muted', 'muted', 'italic', 'muted'],
      ['muted', 'plain', 'muted', 'plain', 'muted', 'plain', 'muted'],
      ['muted', 'bold-italic', 'muted', 'muted'],
    ];
    expect(stylesOf('python', python)).toStrictEqual(pythonLines.flat());
    const go = [
      '«func» «helper»«(»«a» «int»«)» «{» «return» «a»«.»«Value» «+» «2» «}»',
      'func main() { «helper»(1) }',
    ].join('\n');
    const goLines = [
      ['muted', 'bold', 'muted', 'plain', 'italic', 'muted', 'muted', 'muted', 'plain', 'muted'],
      ['plain', 'plain', 'bold', 'muted'],
      ['plain'],
    ];
    expect(stylesOf('go', go)).toStrictEqual(goLines.flat());
    const rust = [
      '«fn» «f»«(»«x»«:» «i32»«)» «{» «x»«.»«value» «*» «7» «}»',
      '«struct» «S» {}',
      'fn g() { «f»(«S»::«new»()) }',
    ].join('\n');
    const rustLines = [
      ['muted', 'bold', 'muted', 'plain', 'muted', 'italic', 'muted', 'muted', 'plain', 'muted'],
      ['plain', 'plain', 'bold', 'muted'],
      ['muted', 'bold-italic'],
      ['plain', 'plain', 'plain'],
    ];
    expect(stylesOf('rust', rust)).toStrictEqual(rustLines.flat());
    const shell = '«build»() { :; }\n«name»«=»«"»«$1»«"»\n«grep» «-q» «foo» «2»';
    const shellLines = [
      ['bold'],
      ['plain', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'bold'],
    ];
    expect(stylesOf('shellscript', shell)).toStrictEqual(shellLines.flat());
  });

  test('bolds Markdown headings and leaves prose regular', ({ expect, stylesOf }) => {
    expect(stylesOf('markdown', '# «Title»\n«Some» prose.')).toStrictEqual(['bold', 'plain']);
  });
});
