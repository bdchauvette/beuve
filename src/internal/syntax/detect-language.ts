import path from 'node:path';

import { grammars } from './grammars.ts';
import type { SyntaxLanguage } from './grammars.ts';

const languageByExtension: ReadonlyMap<string, SyntaxLanguage> = new Map(
  languageIds().flatMap((language) => {
    return grammars[language].extensions.map((extension): [string, SyntaxLanguage] => {
      return [extension, language];
    });
  }),
);

/** The language of a repository path, by extension (case-insensitive), or `undefined`. */
export function detectLanguage(filePath: string): SyntaxLanguage | undefined {
  return languageByExtension.get(path.posix.extname(filePath).toLowerCase());
}

function languageIds(): readonly SyntaxLanguage[] {
  return Object.keys(grammars) as SyntaxLanguage[];
}
