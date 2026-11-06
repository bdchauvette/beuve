import { getSharedHighlighter, registerCustomTheme } from '@pierre/diffs';

import { syntaxPalettes } from '../syntax-palettes.ts';
import { textmateThemeFrom } from '../textmate-theme-from.ts';

const languages = ['typescript', 'go', 'rust', 'python', 'shellscript', 'markdown'] as const;

/** A grammar {@link createStylesOf} loads. */
export type TestLanguage = (typeof languages)[number];

/**
 * How the theme shows a token (ADR 0119): a bold name, an italic type, a muted keyword or
 * punctuation mark, plain regular text (operators, strings, constants), or a comment. Anything
 * else is its color and Shiki font-style flags, so a failure says what it got.
 */
export type TokenStyle = 'name' | 'type' | 'muted' | 'plain' | 'comment' | `${string} ${string}`;

/** The style of the first character of each `«…»`-marked span of `marked`, markers removed. */
export type StylesOf = (lang: TestLanguage, marked: string) => TokenStyle[];

const themeName = 'beuve-test-light';
const italicFlag = 1;
const boldFlag = 2;

/** Registers the light palette's TextMate theme with Shiki and returns {@link StylesOf} over it. */
export async function createStylesOf(): Promise<StylesOf> {
  const light = syntaxPalettes.light;
  // eslint-disable-next-line @typescript-eslint/require-await -- the library's loaders are async.
  registerCustomTheme(themeName, async () => textmateThemeFrom(themeName, 'light', light));
  const highlighter = await getSharedHighlighter({
    themes: [themeName],
    langs: [...languages],
    preferredHighlighter: 'shiki-js',
  });
  const styles = new Map<string, TokenStyle>([
    [`${light.foreground} ${String(boldFlag)}`, 'name'],
    [`${light.foreground} ${String(italicFlag)}`, 'type'],
    [`${light.muted} 0`, 'muted'],
    [`${light.foreground} 0`, 'plain'],
    [`${light.comment} 0`, 'comment'],
  ]);
  return (lang, marked): TokenStyle[] => {
    const offsets: number[] = [];
    const code = marked.replaceAll(/«([^»]*)»/gu, (_match, inner: string, offset: number) => {
      offsets.push(offset - offsets.length * 2);
      return inner;
    });
    const { tokens } = highlighter.codeToTokens(code, { lang, theme: themeName });
    const flat = tokens.flat();
    return offsets.map((offset): TokenStyle => {
      const token = flat.find((candidate) => {
        return candidate.offset <= offset && offset < candidate.offset + candidate.content.length;
      });
      const key: `${string} ${string}` = `${(token?.color ?? light.foreground).toLowerCase()} ${String(Math.max(token?.fontStyle ?? 0, 0))}`;
      return styles.get(key) ?? key;
    });
  };
}
