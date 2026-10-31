import { htmlStructureFrom } from './html-structure-from.ts';

/** HTML rendered from hostile input and from its benign twin. */
export interface RenderedPair {
  readonly hostile: readonly string[];
  readonly benign: readonly string[];
}

/**
 * The elements and attributes (as `htmlStructureFrom` lists them) that `hostile` builds and its
 * benign twin `benign` does not (ADR 0077): an escaping bug shows up here.
 */
export function extraMarkup({ hostile, benign }: RenderedPair): readonly string[] {
  const allowed = new Set(htmlStructureFrom(benign.join('')).markup);
  return htmlStructureFrom(hostile.join('')).markup.filter((entry) => !allowed.has(entry));
}
