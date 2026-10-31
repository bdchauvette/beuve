import { firstHunkLine } from './first-hunk-line.ts';
import { linesOf } from './lines-of.ts';

const hunkHeader = /^@@ -([\d,]+) \+[\d,]+ @@/u;

/** A suggested patch, and the head file it was made against. */
export interface PatchOnHead {
  readonly head: string;
  readonly patch: string;
}

/**
 * The head file with a suggested patch applied, so re-editing a suggestion (ADR 0043) starts
 * from the suggested text rather than the head. Every context and removed line must match the
 * head exactly; `undefined` when the patch doesn't apply (then the editor starts from the head).
 * A `\ No newline at end of file` after an added last line drops the final newline.
 */
export function applySuggestedPatch({ head, patch }: PatchOnHead): string | undefined {
  const source = linesOf(head);
  const isHeadEmpty = head === '';
  const lines = linesOf(patch);
  const output: string[] = [];
  let next = 0;
  let hasFinalNewline = head.endsWith('\n') || isHeadEmpty;
  let lastKind = '';
  let isInHunk = false;
  for (const line of lines) {
    const header = hunkHeader.exec(line);
    if (header !== null) {
      const [start = '', count = '1'] = (header[1] ?? '').split(',', 2);
      const first = firstHunkLine({ start: Number(start), count: Number(count) }) - 1;
      if (first < next || first > source.length) {
        return undefined;
      }
      output.push(...source.slice(next, first));
      next = first;
      isInHunk = true;
      continue;
    }
    if (!isInHunk) {
      continue;
    }
    const kind = line[0] ?? ' ';
    if (kind === '\\') {
      if (lastKind === '+') {
        hasFinalNewline = false;
      }
      continue;
    }
    lastKind = kind;
    const text = line.slice(1);
    if (kind === '+') {
      output.push(text);
      hasFinalNewline = true;
      continue;
    }
    if (source[next] !== text || (kind !== ' ' && kind !== '-')) {
      return undefined;
    }
    if (kind === ' ') {
      output.push(text);
    }
    next += 1;
  }
  if (!isHeadEmpty) {
    output.push(...source.slice(next));
  }
  if (next < source.length) {
    hasFinalNewline = head.endsWith('\n');
  }
  const text = output.join('\n');
  if (output.length === 0) {
    return '';
  }
  if (hasFinalNewline) {
    return `${text}\n`;
  }
  return text;
}
