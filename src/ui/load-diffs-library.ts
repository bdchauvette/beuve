import type * as Diffs from '@pierre/diffs';
import type { LanguageRegistration } from 'shiki';

import { diffsThemeNames } from './diffs-theme-names.ts';
import type { InjectedLanguage } from './grammar-injections.ts';
import { syntaxPalettes } from './syntax-palettes.ts';
import { textmateThemeFrom } from './textmate-theme-from.ts';
import type { TextmateTheme } from './textmate-theme-from.ts';

const shared: { library: Promise<typeof Diffs> | undefined } = { library: undefined };

/**
 * `@pierre/diffs`, a lazy chunk loaded once for every card, sheet and chat code block, with
 * beuve's themes and grammar injections registered once (ADR 0025, 0119). The library logs an
 * error for a theme or language registered twice, so every component loads it through here.
 */
export async function loadDiffsLibrary(): Promise<typeof Diffs> {
  shared.library ??= importWithThemes();
  return shared.library;
}

/** Each injected language's Shiki grammars, a lazy chunk apiece as `shiki/langs` has them. */
const baseGrammars: Readonly<Record<InjectedLanguage, () => Promise<GrammarModule>>> =
  Object.freeze({
    python: async () => {
      return import('shiki/langs/python.mjs');
    },
    rust: async () => {
      return import('shiki/langs/rust.mjs');
    },
    ruby: async () => {
      return import('shiki/langs/ruby.mjs');
    },
    perl: async () => {
      return import('shiki/langs/perl.mjs');
    },
    awk: async () => {
      return import('shiki/langs/awk.mjs');
    },
    fish: async () => {
      return import('shiki/langs/fish.mjs');
    },
  });

/** A `shiki/langs/*` module: a language's grammar and the grammars it embeds. */
interface GrammarModule {
  readonly default: LanguageRegistration[];
}

async function importWithThemes(): Promise<typeof Diffs> {
  const library = await import('@pierre/diffs');
  for (const type of ['light', 'dark'] as const) {
    const name = diffsThemeNames[type];
    // eslint-disable-next-line @typescript-eslint/require-await -- the library's loaders are async.
    library.registerCustomTheme(name, async (): Promise<TextmateTheme> => {
      return textmateThemeFrom(name, type, syntaxPalettes[type]);
    });
  }
  for (const language of Object.keys(baseGrammars) as InjectedLanguage[]) {
    library.registerCustomLanguage(language, async (): Promise<GrammarModule> => {
      const [base, { grammarInjections }] = await Promise.all([
        baseGrammars[language](),
        import('./grammar-injections.ts'),
      ]);
      return { default: [...base.default, grammarInjections[language]] };
    });
  }
  // `.pl` is Prolog to the library; in a code review it is far more often Perl.
  library.setCustomExtension('pl', 'perl');
  return library;
}
