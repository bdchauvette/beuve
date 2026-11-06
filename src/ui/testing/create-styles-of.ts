import { diffsThemeNames } from '../diffs-theme-names.ts';
import { loadDiffsLibrary } from '../load-diffs-library.ts';
import { syntaxPalettes } from '../syntax-palettes.ts';

const languages = [
  'typescript',
  'go',
  'rust',
  'python',
  'shellscript',
  'fish',
  'ruby',
  'perl',
  'awk',
  'css',
  'html',
  'markdown',
] as const;

/** A grammar {@link createStylesOf} loads. */
export type TestLanguage = (typeof languages)[number];

/**
 * How the theme shows a token (ADR 0119): bold (a definition or a number), italic (a type), bold
 * italic (a type's definition), muted (a keyword or punctuation mark), plain regular text (names,
 * operators, strings), or a comment. Anything else is its color and Shiki font-style flags, so a
 * failure says what it got.
 */
export type TokenStyle =
  'bold' | 'italic' | 'bold-italic' | 'muted' | 'plain' | 'comment' | `${string} ${string}`;

/** The style of the first character of each `«…»`-marked span of `marked`, markers removed. */
export type StylesOf = (lang: TestLanguage, marked: string) => TokenStyle[];

const themeName = diffsThemeNames.light;
const italicFlag = 1;
const boldFlag = 2;

/**
 * Loads the library as the app does (beuve's themes registered) and
 * returns {@link StylesOf} over the light theme.
 */
export async function createStylesOf(): Promise<StylesOf> {
  const light = syntaxPalettes.light;
  const library = await loadDiffsLibrary();
  const highlighter = await library.getSharedHighlighter({
    themes: [themeName],
    langs: [...languages],
    preferredHighlighter: 'shiki-js',
  });
  const styles = new Map<string, TokenStyle>([
    [`${light.foreground} ${String(boldFlag)}`, 'bold'],
    [`${light.foreground} ${String(italicFlag)}`, 'italic'],
    [`${light.foreground} ${String(boldFlag + italicFlag)}`, 'bold-italic'],
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
