import type { FileReference, FileReferenceIndex } from './file-reference-index.ts';

/** A run of prose, or a word of it that names a file of the review. */
export type FileReferencePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reference'; readonly text: string; readonly reference: FileReference };

/** A word as far as the characters a path can't end in or a sentence puts around it. */
const word = /[^\s`'"()<>[\]{},;!?*|]+/gu;
const trailing = /[.:]+$/u;

/**
 * `text` (prose from a chat answer, ADR 0128) split around the words that name files `index`
 * knows: `src/foo.ts:12`, `foo.ts`. A word must have a `.` or a `/` to be looked up, and the full
 * stops and colons that end a sentence or a label stay text. Pure.
 */
export function fileReferencePartsFrom(
  text: string,
  index: FileReferenceIndex,
): readonly FileReferencePart[] {
  if (index.isEmpty || (!text.includes('.') && !text.includes('/'))) {
    return [{ kind: 'text', text }];
  }
  const parts: FileReferencePart[] = [];
  let done = 0;
  for (const match of text.matchAll(word)) {
    const candidate = match[0].replace(trailing, '');
    if (!candidate.includes('.') && !candidate.includes('/')) {
      continue;
    }
    const reference = index.resolve(candidate);
    if (reference === undefined) {
      continue;
    }
    if (match.index > done) {
      parts.push({ kind: 'text', text: text.slice(done, match.index) });
    }
    parts.push({ kind: 'reference', text: candidate, reference });
    done = match.index + candidate.length;
  }
  if (done < text.length) {
    parts.push({ kind: 'text', text: text.slice(done) });
  }
  return parts;
}
