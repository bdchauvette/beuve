import { getSharedHighlighter, registerCustomTheme } from '@pierre/diffs';

import { syntaxPalettes } from '../syntax-palettes.ts';
import { textmateThemeFrom } from '../textmate-theme-from.ts';

/** The color of the first character of each `«…»`-marked span of `marked`, markers removed. */
export type ColorsOf = (lang: string, marked: string) => string[];

const themeName = 'beuve-test-light';

/** Registers the light palette's TextMate theme with Shiki and returns {@link ColorsOf} over it. */
export async function createColorsOf(): Promise<ColorsOf> {
  const light = syntaxPalettes.light;
  // eslint-disable-next-line @typescript-eslint/require-await -- the library's loaders are async.
  registerCustomTheme(themeName, async () => textmateThemeFrom(themeName, 'light', light));
  const highlighter = await getSharedHighlighter({
    themes: [themeName],
    langs: ['typescript', 'go', 'rust', 'python', 'shellscript'],
    preferredHighlighter: 'shiki-js',
  });
  return (lang, marked): string[] => {
    const offsets: number[] = [];
    const code = marked.replaceAll(/«([^»]*)»/gu, (_match, inner: string, offset: number) => {
      offsets.push(offset - offsets.length * 2);
      return inner;
    });
    const { tokens } = highlighter.codeToTokens(code, { lang, theme: themeName });
    const flat = tokens.flat();
    return offsets.map((offset) => {
      const token = flat.find(
        (candidate) =>
          candidate.offset <= offset && offset < candidate.offset + candidate.content.length,
      );
      return (token?.color ?? light.foreground).toLowerCase();
    });
  };
}
