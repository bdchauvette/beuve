import type * as Diffs from '@pierre/diffs';

import { diffsThemeNames } from './diffs-theme-names.ts';
import { syntaxPalettes } from './syntax-palettes.ts';
import { textmateThemeFrom } from './textmate-theme-from.ts';
import type { TextmateTheme } from './textmate-theme-from.ts';

const shared: { library: Promise<typeof Diffs> | undefined } = { library: undefined };

/**
 * `@pierre/diffs`, a lazy chunk loaded once for every card, sheet and chat code block, with
 * beuve's themes registered once (ADR 0025). The library logs an error for a theme registered
 * twice, so every component loads it through here.
 */
export async function loadDiffsLibrary(): Promise<typeof Diffs> {
  shared.library ??= importWithThemes();
  return shared.library;
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
  return library;
}
