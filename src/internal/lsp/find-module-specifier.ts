import type { ProbeToken } from './plan-definition-probes.ts';

const specifierPattern = /\b(?:from|import|require)\s*\(?\s*(['"])([^'"\r\n]+)\1/gu;

/**
 * The module specifier under `character` on a line, as the token between its quotes (UTF-16
 * columns, the end exclusive): `./auth` in `import { a } from './auth'`, in `import './auth'`,
 * `import('./auth')` and `require('./auth')`. Asking the language server for a definition at its
 * start answers the module's file, which is what a click on the path follows (ADR 0105). Pure.
 */
export function findModuleSpecifier(text: string, character: number): ProbeToken | undefined {
  for (const match of text.matchAll(specifierPattern)) {
    const [whole, quote = '', content = ''] = match;
    const start = match.index + whole.length - quote.length - content.length;
    const end = start + content.length;
    if (start <= character && character < end) {
      return { start, end, text: content };
    }
  }
  return undefined;
}
