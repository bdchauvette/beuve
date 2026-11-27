import { diffsThemeNames } from './diffs-theme-names.ts';
import { highlightedLanguages } from './highlighted-languages.ts';
import { languageFromShebang } from './language-from-shebang.ts';
import { loadDiffsLibrary } from './load-diffs-library.ts';
import { tokenMarksFrom } from './token-marks-from.ts';
import type { TokenMark } from './token-marks-from.ts';

/** Text to highlight, and the path that names its language. */
export interface TokenMarksRequest {
  readonly path: string;
  readonly text: string;
}

/** Longer texts stay plain: a suggestion is retokenized whole on every change. */
const maxHighlightedCharacters = 20_000;

/**
 * The highlighting of a suggestion field's text (ADR 0162): beuve's shared Shiki highlighter on
 * the main thread, as small diffs use it (ADR 0050), with beuve's light and dark themes (ADR 0119)
 * and the language the diff gives the path, or its `#!` line (ADR 0120). No marks for a language
 * beuve ships no grammar for, or a long text.
 */
export async function loadTokenMarks(request: TokenMarksRequest): Promise<TokenMark[]> {
  const { path, text } = request;
  if (text.length > maxHighlightedCharacters) {
    return [];
  }
  const library = await loadDiffsLibrary();
  let language: string | undefined = library.getFiletypeFromFileName(path);
  if (!Object.hasOwn(highlightedLanguages, language)) {
    const [firstLine] = text.split('\n', 1);
    language = languageFromShebang(firstLine?.trimEnd());
  }
  if (language === undefined) {
    return [];
  }
  const highlighter = await library.getSharedHighlighter({
    themes: [diffsThemeNames.light, diffsThemeNames.dark],
    langs: [language],
    preferredHighlighter: 'shiki-js',
  });
  const { tokens } = highlighter.codeToTokens(text, {
    lang: language,
    themes: { ...diffsThemeNames },
    defaultColor: false,
    cssVariablePrefix: '--diffs-token-',
  });
  return tokenMarksFrom(tokens);
}
