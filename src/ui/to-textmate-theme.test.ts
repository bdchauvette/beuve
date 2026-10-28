import { getSharedHighlighter, registerCustomTheme } from '@pierre/diffs';
import { beforeAll, describe, expect, it } from 'vitest';

import { syntaxPalettes } from './syntax-palettes.ts';
import { toTextmateTheme } from './to-textmate-theme.ts';

const light = syntaxPalettes.light;
const styledScope = /keyword|punctuation(?!\.definition\.comment)|storage|operator/u;
const fontStyles = /fontStyle|bold|italic/u;
const marker = /«([^»]*)»/gu;

describe('toTextmateTheme', () => {
  it('colors only comments, strings, constants and definitions', () => {
    const theme = toTextmateTheme('t', 'light', light);
    expect(theme).toMatchObject({ name: 't', type: 'light', fg: '#000000', bg: '#f7f7f7' });
    const colors = new Set(theme.tokenColors.map((rule) => rule.settings.foreground));
    expect(colors).toEqual(
      new Set([light.comment, light.string, light.constant, light.definition, light.foreground]),
    );
    const scopes = theme.tokenColors.flatMap((rule) => rule.scope);
    expect(scopes.filter((scope) => styledScope.test(scope))).toEqual([]);
    expect(JSON.stringify(theme)).not.toMatch(fontStyles);
  });
});

describe('toTextmateTheme through Shiki (as the diff view highlights)', () => {
  /** The color of the first character of each `«…»`-marked span, markers removed. */
  let colorsOf: (lang: string, marked: string) => string[];

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/require-await -- the library's loaders are async.
    registerCustomTheme('beuve-test-light', async () =>
      toTextmateTheme('beuve-test-light', 'light', light),
    );
    const highlighter = await getSharedHighlighter({
      themes: ['beuve-test-light'],
      langs: ['typescript', 'go', 'rust', 'python', 'shellscript'],
      preferredHighlighter: 'shiki-js',
    });
    colorsOf = (lang, marked): string[] => {
      const offsets: number[] = [];
      const code = marked.replaceAll(marker, (_match, inner: string, offset: number) => {
        offsets.push(offset - offsets.length * 2);
        return inner;
      });
      const { tokens } = highlighter.codeToTokens(code, { lang, theme: 'beuve-test-light' });
      const flat = tokens.flat();
      return offsets.map((offset) => {
        const token = flat.find(
          (candidate) =>
            candidate.offset <= offset && offset < candidate.offset + candidate.content.length,
        );
        return (token?.color ?? light.foreground).toLowerCase();
      });
    };
  });

  it('leaves keywords, operators, punctuation, calls and type references plain in TypeScript', () => {
    const { foreground: plain, comment, string, constant, definition } = light;
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
    expect(colorsOf('typescript', code)).toEqual([
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

  it('colors definitions but not calls in Go, Rust, Python and shell', () => {
    const { foreground: plain, definition } = light;
    expect(colorsOf('go', 'func «helper»() {}\nfunc main() { «helper»() }')).toEqual([
      definition,
      plain,
    ]);
    expect(colorsOf('rust', 'fn «helper»() {}\nfn main() { «helper»(); }')).toEqual([
      definition,
      plain,
    ]);
    expect(colorsOf('python', 'def «build»():\n    return «build»()')).toEqual([definition, plain]);
    expect(colorsOf('shellscript', '«build»() { :; }\n«build»\n«make» all')).toEqual([
      definition,
      plain,
      plain,
    ]);
  });
});
