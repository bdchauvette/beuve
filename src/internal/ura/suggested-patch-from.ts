import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { UraSuggestion } from './ura-item.ts';

/** Why a suggestion has no patch: its lines aren't in the file, or it changes nothing. */
export type SuggestedPatchError =
  { readonly kind: 'out-of-range'; readonly lineCount: number } | { readonly kind: 'unchanged' };

/** A text's lines without their `\n` (a `\r` stays), and whether it ends with one. */
interface SplitText {
  readonly lines: readonly string[];
  readonly endsWithNewline: boolean;
}

/** The changed lines once the lines a suggestion keeps as they are are trimmed off. */
interface Core {
  /** 0-based index of the first old line changed, and the index after the last. */
  readonly first: number;
  readonly last: number;
  readonly added: readonly string[];
}

const contextLines = 3;
const noNewline = '\\ No newline at end of file';

/**
 * The unified diff for one suggestion (ADR 0162), derived from `head`, the text of the
 * suggestion's file at the head it was written against: `--- a/` / `+++ b/` headers and one hunk
 * with up to three context lines. Lines the replacement keeps at either end of the range become
 * context, so the hunk shows only what changes. Lines keep a trailing `\r`; a missing final newline
 * gets git's marker, and the file keeps it missing. Pure.
 */
export function suggestedPatchFrom(
  head: string,
  suggestion: UraSuggestion,
): Result<string, SuggestedPatchError> {
  const before = splitText(head);
  const count = before.lines.length;
  if (suggestion.startLine > count + 1 || suggestion.endLine > count) {
    return err({ kind: 'out-of-range', lineCount: count });
  }
  const core = coreOf(before, suggestion);
  if (core === undefined) {
    return err({ kind: 'unchanged' });
  }
  const { first, last, added } = core;
  const isAtEnd = last === count && !before.endsWithNewline;
  const leading = before.lines.slice(Math.max(0, first - contextLines), first);
  const removed = before.lines.slice(first, last);
  const trailing = before.lines.slice(last, last + contextLines);
  const body = leading.map((line) => ` ${line}`);
  body.push(...removed.map((line) => `-${line}`));
  if (isAtEnd && removed.length > 0) {
    body.push(noNewline);
  }
  body.push(...added.map((line) => `+${line}`));
  if (isAtEnd && added.length > 0) {
    body.push(noNewline);
  }
  body.push(...trailing.map((line) => ` ${line}`));
  if (trailing.length > 0 && last + trailing.length === count && !before.endsWithNewline) {
    body.push(noNewline);
  }
  const start = first - leading.length + 1;
  const oldSide = side({ start, count: leading.length + removed.length + trailing.length });
  const newSide = side({ start, count: leading.length + added.length + trailing.length });
  const { path } = suggestion;
  return ok(
    [`--- a/${path}`, `+++ b/${path}`, `@@ -${oldSide} +${newSide} @@`, ...body, ''].join('\n'),
  );
}

function splitText(text: string): SplitText {
  if (text === '') {
    return { lines: [], endsWithNewline: true };
  }
  const lines = text.split('\n');
  const isEndingWithNewline = text.endsWith('\n');
  if (isEndingWithNewline) {
    lines.pop();
  }
  return { lines, endsWithNewline: isEndingWithNewline };
}

/**
 * The suggestion's change with unchanged lines trimmed from both ends, or `undefined` when it
 * changes nothing. At the end of a file without a final newline, a change that only adds or only
 * removes lines also changes which line ends the file, so it takes the line before it along.
 */
function coreOf(before: SplitText, suggestion: UraSuggestion): Core | undefined {
  let first = suggestion.startLine - 1;
  let last = suggestion.endLine;
  const added = linesOfReplacement(suggestion.replacement);
  while (first < last && added.length > 0 && before.lines[first] === added[0]) {
    first += 1;
    added.shift();
  }
  while (first < last && added.length > 0 && before.lines[last - 1] === added.at(-1)) {
    last -= 1;
    added.pop();
  }
  if (first === last && added.length === 0) {
    return undefined;
  }
  const isOneSided = first === last || added.length === 0;
  const isAtEnd = last === before.lines.length && !before.endsWithNewline;
  if (isAtEnd && isOneSided && first > 0) {
    first -= 1;
    added.unshift(before.lines[first] ?? '');
  }
  return { first, last, added };
}

/** A replacement's lines: `''` is none. */
function linesOfReplacement(replacement: string): string[] {
  if (replacement === '') {
    return [];
  }
  return replacement.split('\n');
}

/** One side of a hunk header: its first line and how many lines it has. */
interface HunkSide {
  readonly start: number;
  readonly count: number;
}

/** `start,count`, with git's convention that an empty side starts at the line before it. */
function side({ start, count }: HunkSide): string {
  if (count === 0) {
    return `${String(start - 1)},0`;
  }
  return `${String(start)},${String(count)}`;
}
