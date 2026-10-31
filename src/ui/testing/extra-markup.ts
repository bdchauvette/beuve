import { htmlStructureFrom } from './html-structure-from.ts';

/**
 * The elements and attributes (as `htmlStructureFrom` lists them) that `hostile` builds and its
 * benign twin `benign` does not (ADR 0077): an escaping bug shows up here.
 */
export function extraMarkup(
  hostile: readonly string[],
  benign: readonly string[],
): readonly string[] {
  const allowed = new Set(htmlStructureFrom(benign.join('')).markup);
  return htmlStructureFrom(hostile.join('')).markup.filter((entry) => !allowed.has(entry));
}
