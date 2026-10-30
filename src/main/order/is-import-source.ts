import { detectLanguage } from '#internal/syntax/detect-language.ts';

/** Whether imports can be read from `path`: a TypeScript, TSX or JavaScript file. */
export function isImportSource(path: string): boolean {
  return detectLanguage(path) !== undefined;
}
