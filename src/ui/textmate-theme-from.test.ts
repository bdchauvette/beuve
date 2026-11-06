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
      ['muted', 'muted', 'bold', 'muted', 'bold', 'muted', 'muted', 'italic', 'muted', 'muted'],
      ['muted', 'italic', 'muted', 'italic', 'muted', 'italic', 'muted', 'muted'],
      ['muted', 'bold', 'plain', 'muted', 'plain', 'muted', 'muted', 'plain', 'muted', 'plain'],
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

  test('styles definitions, parameters and types alike in Python, Go, Rust and shell', ({
    expect,
    stylesOf,
  }) => {
    const python = [
      '«def» «build»«(»«items»«:» «list»«[»«Item»«]»«,» «n»«=»«3»«)» «->» «Widget»«:»',
      '    «return» «Widget»«(»«items»«.»«key»«)»',
      '«class» «Widget»«:» «pass»',
    ].join('\n');
    const pythonLines = [
      ['muted', 'bold', 'muted', 'bold', 'muted', 'italic', 'muted', 'italic', 'muted', 'muted'],
      ['bold', 'plain', 'bold', 'muted', 'muted', 'italic', 'muted'],
      ['muted', 'plain', 'muted', 'plain', 'muted', 'plain', 'muted'],
      ['muted', 'bold-italic', 'muted', 'muted'],
    ];
    expect(stylesOf('python', python)).toStrictEqual(pythonLines.flat());
    const go = [
      '«func» «helper»«(»«a» «int»«)» «{» «return» «a»«.»«Value» «+» «2» «}»',
      'func main() { «helper»(1) }',
    ].join('\n');
    const goLines = [
      ['muted', 'bold', 'muted', 'bold', 'italic', 'muted', 'muted', 'muted', 'plain', 'muted'],
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
      ['muted', 'bold', 'muted', 'bold', 'muted', 'italic', 'muted', 'muted', 'plain', 'muted'],
      ['plain', 'plain', 'bold', 'muted'],
      ['muted', 'bold-italic'],
      ['plain', 'plain', 'plain'],
    ];
    expect(stylesOf('rust', rust)).toStrictEqual(rustLines.flat());
    const shell = '«build»() { :; }\n«name»«=»«"»«$1»«"»\n«grep» «-q» «foo» «2»';
    const shellLines = [
      ['bold'],
      ['bold', 'plain', 'plain', 'plain', 'plain'],
      ['plain', 'plain', 'plain', 'bold'],
    ];
    expect(stylesOf('shellscript', shell)).toStrictEqual(shellLines.flat());
  });

  test('bolds Markdown headings and leaves prose regular', ({ expect, stylesOf }) => {
    expect(stylesOf('markdown', '# «Title»\n«Some» prose.')).toStrictEqual(['bold', 'plain']);
  });
});

describe("textmateThemeFrom with beuve's grammar injections, across languages", () => {
  test('bolds declarations and parameters but not reassignments in TypeScript', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      'const «w» = «1»; let [«a», «b»] = «c»; «w» = «2»; for (const «k» of «ks») {}',
      'function «f»(«p»: «T») {}',
    ].join('\n');
    const lines = [
      ['bold', 'bold', 'bold', 'bold', 'plain', 'plain', 'bold', 'bold', 'plain'],
      ['bold', 'bold', 'italic'],
    ];
    expect(stylesOf('typescript', code)).toStrictEqual(lines.flat());
  });

  test('bolds assignment, for and as targets in Python, but not keyword arguments', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«w» = «1»',
      '«a», «b» = «c»',
      '«w» += «2»',
      'for «k» in «ks»: «pass»',
      'with «f»() as «g»: pass',
      '«x»: «Foo» = «3»',
      '«foo»(«key»=«1»)',
      'if «a» == «b»: pass',
      '«obj».«x» = «1»',
      'import «os» as «o»',
    ].join('\n');
    const lines = [
      ['bold', 'bold'],
      ['bold', 'bold', 'plain'],
      ['plain', 'bold'],
      ['bold', 'plain', 'muted'],
      ['plain', 'bold'],
      ['bold', 'plain', 'bold'],
      ['plain', 'plain', 'bold'],
      ['plain', 'plain'],
      ['plain', 'plain', 'bold'],
      ['plain', 'bold'],
    ];
    expect(stylesOf('python', code)).toStrictEqual(lines.flat());
  });

  test('bolds Go declarations and parameters, not their uses', ({ expect, stylesOf }) => {
    const code = [
      'var «a» int = 1',
      '«w» := 2',
      'const «c» = 4',
      'func «f»(«p» int) { «g»(«c», «p») }',
    ].join('\n');
    const lines = [['bold'], ['bold'], ['bold'], ['bold', 'bold', 'plain', 'plain', 'plain']];
    expect(stylesOf('go', code)).toStrictEqual(lines.flat());
  });

  test('bolds Rust let, const, static, for and parameters, not reassignments', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«let» «w» = «1»; let «mut» «m» = 2; «m» = 3; «const» «C»: u8 = 4; static «S»: u8 = 5;',
      'for «i» in «xs» {}',
      '«pub» «fn» «f»«(»«x»«:» «i32»«,» «mut» «y»«:» «&»«str»«)» «->» «u8» { «x» }',
      'fn «g»<«T»: «Clone»>(«t»: «T») {}',
    ].join('\n');
    const lines = [
      ['muted', 'bold', 'bold', 'muted', 'bold', 'plain', 'muted', 'bold', 'bold'],
      ['bold', 'plain'],
      [
        'muted',
        'muted',
        'bold',
        'muted',
        'bold',
        'muted',
        'italic',
        'muted',
        'muted',
        'bold',
        'muted',
        'plain',
        'italic',
        'muted',
        'muted',
        'italic',
        'plain',
      ],
      ['bold', 'italic', 'italic', 'bold', 'italic'],
    ];
    expect(stylesOf('rust', code)).toStrictEqual(lines.flat());
  });

  test('bolds shell assignments, for variables and functions, not expansions', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«name»=1',
      'local «x»=2',
      'for «f» in a; do echo «$f» «$1»; done',
      '«build»() { :; }',
    ].join('\n');
    const lines = [['bold'], ['bold'], ['bold', 'plain', 'plain'], ['bold']];
    expect(stylesOf('shellscript', code)).toStrictEqual(lines.flat());
  });

  test('bolds fish set, for and function names and argument names, and numbers', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«set» «-gx» «PATH» «$PATH» /bin',
      '«function» «greet» «--argument-names» «who» «n»',
      '  «echo» «hi» «$who» «42» «file2» «/x/3»«;» end',
      'for «f» in «a» b',
      'end',
      '«set» «x» «1.5»',
    ].join('\n');
    const lines = [
      ['plain', 'plain', 'bold', 'muted'],
      ['muted', 'bold', 'plain', 'bold', 'bold'],
      ['plain', 'plain', 'muted', 'bold', 'plain', 'plain', 'muted'],
      ['bold', 'plain'],
      [],
      ['plain', 'bold', 'bold'],
    ];
    expect(stylesOf('fish', code)).toStrictEqual(lines.flat());
  });

  test('bolds Ruby assignments, instance variables, constants and block parameters', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«class» «Widget» < «Base»',
      '  «def» «build»(«items», «limit» = «10»)',
      '    «w» = «Widget».«new»(«items»)',
      '    @«count» = «3»',
      '    @«count» += 1',
      '    @«memo» ||= «w»',
      '    «LIMIT» = 5',
      '    «items».«each» { |«i»| «puts» «i».«name» }',
      '    «return» «w»',
      '  end',
      'end',
      '«module» «Foo»; end',
    ].join('\n');
    const lines = [
      ['muted', 'bold-italic', 'italic'],
      ['muted', 'bold', 'bold', 'bold', 'bold'],
      ['bold', 'plain', 'muted', 'plain'],
      ['bold', 'bold'],
      ['plain'],
      ['bold', 'plain'],
      ['bold'],
      ['plain', 'plain', 'bold', 'plain', 'plain', 'plain'],
      ['muted', 'plain'],
      [],
      [],
      ['muted', 'bold-italic'],
    ];
    expect(stylesOf('ruby', code)).toStrictEqual(lines.flat());
  });

  test('bolds Perl my, our and sub, and numbers, and mutes its punctuation', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«package» «Foo::Bar»«;»',
      '«my» «$»«x» «=» «1»«;»',
      'my «(»$«self»«,» $«n»«)» = @«_»;',
      '$«x» = «0x1f» «+» «2.5e3»;',
      'sub «build» «{» «return» $«self»«->»«{»«name»«}» . $«n» «*» «3»«;» «}»',
      'sub «g» { «return» 1 }',
    ].join('\n');
    const lines = [
      ['muted', 'bold-italic', 'muted'],
      ['muted', 'muted', 'bold', 'plain', 'bold', 'muted'],
      ['muted', 'bold', 'muted', 'bold', 'muted', 'plain'],
      ['plain', 'bold', 'plain', 'bold'],
      [
        'bold',
        'muted',
        'muted',
        'plain',
        'plain',
        'muted',
        'plain',
        'muted',
        'plain',
        'plain',
        'bold',
        'muted',
        'muted',
      ],
      ['bold', 'muted'],
    ];
    expect(stylesOf('perl', code)).toStrictEqual(lines.flat());
  });

  test('bolds awk assignment targets, for variables and functions, and mutes its punctuation', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      '«BEGIN» «{» «FS» = «","»«;» «count» «=» «0» «}»',
      '{ «total» += «$3»; «names»«[»«$1»«]» = «$2» }',
      'function «avg»(«a», «n») { return «a» / «n» }',
      'END { for «(»«k» in «names») «print» «k»«,» «total» «*» «1.5» }',
    ].join('\n');
    const lines = [
      ['plain', 'muted', 'bold', 'plain', 'muted', 'bold', 'plain', 'bold', 'muted'],
      ['plain', 'plain', 'bold', 'muted', 'plain', 'muted', 'plain'],
      ['bold', 'bold', 'bold', 'plain', 'plain'],
      ['muted', 'bold', 'plain', 'muted', 'plain', 'muted', 'plain', 'plain', 'bold'],
    ];
    expect(stylesOf('awk', code)).toStrictEqual(lines.flat());
  });

  test('bolds CSS custom property declarations and numbers, not var() uses', ({
    expect,
    stylesOf,
  }) => {
    const code = [
      ':«root» { «--beuve-bg»: «#»«fff»«;» }',
      '«.»«card» «>» «a»«:»«hover» { «color»«:» «var»«(»«--beuve-bg»«)»; «margin»: «0» «4»«px»; }',
      '«@»«media» («width» > «600»px) { «div» { «display»: «grid» } }',
    ].join('\n');
    const lines = [
      ['plain', 'bold', 'muted', 'plain', 'muted'],
      [
        'muted',
        'plain',
        'plain',
        'plain',
        'muted',
        'plain',
        'plain',
        'muted',
        'plain',
        'muted',
        'plain',
        'muted',
        'plain',
        'bold',
        'bold',
        'muted',
      ],
      ['muted', 'muted', 'plain', 'bold', 'plain', 'plain', 'plain'],
    ];
    expect(stylesOf('css', code)).toStrictEqual(lines.flat());
  });

  test('mutes HTML tag punctuation and styles embedded script as code', ({ expect, stylesOf }) => {
    const code = [
      '«<»«div» «class»«=»«"»«card»" «data-x»="1"«>»«Link» «&»«amp»; text«</»«div»«>»',
      '<«script»>«const» «w» = «1»;</script>',
    ].join('\n');
    const lines = [
      [
        'muted',
        'plain',
        'plain',
        'muted',
        'plain',
        'plain',
        'plain',
        'muted',
        'plain',
        'muted',
        'plain',
        'muted',
        'plain',
        'muted',
      ],
      ['plain', 'muted', 'bold', 'bold'],
    ];
    expect(stylesOf('html', code)).toStrictEqual(lines.flat());
  });

  test('bolds declarations on indented lines too, inside a body', ({ expect, stylesOf }) => {
    const fish = [
      'function build --argument-names dir',
      '    «set» -l «count» 0',
      '    «for» «f» in $dir',
      '        «set» «count» 1',
      '    end',
      'end',
      'test x; «set» «y» 2',
    ].join('\n');
    expect(stylesOf('fish', fish)).toStrictEqual([
      'plain',
      'bold',
      'muted',
      'bold',
      'plain',
      'bold',
      'plain',
      'bold',
    ]);
    const rust =
      'fn f() {\n    «let» «w» = 1;\n    for «i» in xs {\n        «let» «mut» «m» = «i»;\n    }\n}';
    expect(stylesOf('rust', rust)).toStrictEqual([
      'muted',
      'bold',
      'bold',
      'muted',
      'muted',
      'bold',
      'plain',
    ]);
    const perl =
      'sub f {\n    «my» $«x» = 1;\n    for «my» $«i» (@l) { «my» ($«a», $«b») = @_; }\n}';
    expect(stylesOf('perl', perl)).toStrictEqual([
      'muted',
      'bold',
      'muted',
      'bold',
      'muted',
      'bold',
      'bold',
    ]);
    const awk = '{\n    «x» = 1\n    for («k» in a) { «y» = «k» }\n}';
    expect(stylesOf('awk', awk)).toStrictEqual(['bold', 'bold', 'bold', 'plain']);
    const python =
      'def f():\n    «w» = 1\n    for «k» in «ks»:\n        «a», «b» = «k»\n    with «g»() as «h»: pass';
    expect(stylesOf('python', python)).toStrictEqual([
      'bold',
      'bold',
      'plain',
      'bold',
      'bold',
      'plain',
      'plain',
      'bold',
    ]);
  });
});
