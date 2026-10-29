/** Head lines a suggestion replaces, 1-based and inclusive. */
export interface EditedRange {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * What an edit of the head file amounts to: a unified diff for the edited range, no change at
 * all, or a change outside the range (which a suggestion anchored there can't carry).
 */
export type SuggestedPatchPlan =
  | { readonly kind: 'patch'; readonly text: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'outside'; readonly message: string };

interface SplitText {
  readonly lines: readonly string[];
  readonly endsWithNewline: boolean;
}

const noNewline = '\\ No newline at end of file';

/**
 * Turns an inline edit of the head file into a suggested patch (ADR 0043): a single hunk that
 * removes exactly the head lines `range` names and adds what the reviewer wrote in their place,
 * with up to `contextLines` unchanged lines around it, under `--- a/<path>` / `+++ b/<path>`
 * headers. Everything outside the range must be as it was. Because the hunk removes every
 * anchored line, the GitHub exporter can post it as a ```` ```suggestion ```` for exactly those
 * lines. Lines keep a trailing `\r`; a missing final newline gets git's marker. Pure; main
 * validates the result again with the URA domain's `parseSuggestedPatch`.
 */
export function buildSuggestedPatch(
  path: string,
  head: string,
  edited: string,
  range: EditedRange,
  contextLines = 3,
): SuggestedPatchPlan {
  const before = splitText(head);
  const after = splitText(edited);
  const prefix = range.startLine - 1;
  const suffix = before.lines.length - range.endLine;
  const replacementEnd = after.lines.length - suffix;
  const isNewlineKept = suffix === 0 || before.endsWithNewline === after.endsWithNewline;
  if (
    !isNewlineKept ||
    prefix < 0 ||
    suffix < 0 ||
    replacementEnd < prefix ||
    !isSameLines(after.lines.slice(0, prefix), before.lines.slice(0, prefix)) ||
    !isSameLines(after.lines.slice(replacementEnd), before.lines.slice(range.endLine))
  ) {
    return {
      kind: 'outside',
      message: `Edits must stay within lines ${String(range.startLine)}–${String(range.endLine)}.`,
    };
  }
  const removed = before.lines.slice(prefix, range.endLine);
  const added = after.lines.slice(prefix, replacementEnd);
  if (isSameLines(removed, added) && before.endsWithNewline === after.endsWithNewline) {
    return { kind: 'unchanged' };
  }
  const leading = before.lines.slice(Math.max(0, prefix - contextLines), prefix);
  const trailing = before.lines.slice(range.endLine, range.endLine + contextLines);
  const isAtEnd = range.endLine + trailing.length === before.lines.length;
  const oldStart = prefix - leading.length + 1;
  const oldCount = leading.length + removed.length + trailing.length;
  const newCount = leading.length + added.length + trailing.length;
  const body = [
    ...leading.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...(suffix === 0 && !before.endsWithNewline && removed.length > 0 ? [noNewline] : []),
    ...added.map((line) => `+${line}`),
    ...(suffix === 0 && !after.endsWithNewline && added.length > 0 ? [noNewline] : []),
    ...trailing.map((line) => ` ${line}`),
    ...(isAtEnd && suffix > 0 && !before.endsWithNewline ? [noNewline] : []),
  ];
  return {
    kind: 'patch',
    text: [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -${side(oldStart, oldCount)} +${side(oldStart, newCount)} @@`,
      ...body,
      '',
    ].join('\n'),
  };
}

function splitText(text: string): SplitText {
  if (text === '') {
    return { lines: [], endsWithNewline: true };
  }
  const isEndsWithNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (isEndsWithNewline) {
    lines.pop();
  }
  return { lines, endsWithNewline: isEndsWithNewline };
}

function isSameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** `start,count`, with git's convention that an empty side starts at the line before it. */
function side(start: number, count: number): string {
  return `${String(count === 0 ? start - 1 : start)},${String(count)}`;
}
