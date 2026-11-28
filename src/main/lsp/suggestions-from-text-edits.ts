import type { UraSuggestionDraftView } from '#contract/ipc-contract.ts';
import { convertCharacter } from '#internal/lsp/convert-character.ts';
import type { LspPosition, LspTextEdit, PositionEncoding } from '#internal/lsp/lsp-protocol.ts';
import { positionEncodings } from '#internal/lsp/position-encodings.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

/** An LSP line's terminator, at the end of its text. */
const lineTerminator = /\r?\n$|\r$/u;
/** Every LSP line terminator. */
const lineTerminators = /\r\n|\r|\n/gu;

/** One file's text edits from a language server, and the file's text at the head they apply to. */
export interface FileTextEdits {
  /** Repository-relative, as the suggestions name it. */
  readonly path: string;
  readonly text: string;
  readonly edits: readonly LspTextEdit[];
  /** The encoding the edits' columns are in. */
  readonly encoding: PositionEncoding;
}

/**
 * A rename's edits to one file as a note's suggestions (ADR 0163): the edits are applied to the
 * head's text, and each run of changed lines with no unchanged line between them becomes one
 * suggestion of whole lines, in line order. Lines the edits rewrite to what they were are left
 * out. Positions follow LSP (`\r\n`, `\n` and `\r` end a line; a column past the end of its line is
 * its end); suggestion lines are `\n`-separated, so a `\r` stays in its line. An `err` says why the
 * edits can't be suggestions: they overlap, point past the file, or change its final newline,
 * which a replacement can't say. Pure.
 */
export function suggestionsFromTextEdits(
  file: FileTextEdits,
): Result<readonly UraSuggestionDraftView[], string> {
  const spans = spansFrom(file);
  if (!spans.ok) {
    return spans;
  }
  const { text } = file;
  let after = '';
  let offset = 0;
  for (const span of spans.value) {
    after += text.slice(offset, span.start) + span.newText;
    offset = span.end;
  }
  after += text.slice(offset);
  if (text.endsWith('\n') !== after.endsWith('\n')) {
    return err('the edits change its final newline');
  }
  const lines = modelLinesOf(text);
  const suggestions: UraSuggestionDraftView[] = [];
  for (const group of groupsOf(spans.value, lines)) {
    const suggestion = suggestionOf(group, { path: file.path, text, lines });
    if (suggestion === 'unsayable') {
      return err('an edit leaves one empty line in an empty file, which a suggestion can’t say');
    }
    if (suggestion !== undefined) {
      suggestions.push(suggestion);
    }
  }
  return ok(suggestions);
}

/** An edit as UTF-16 offsets into the text. */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

/** Edits that touch the same or neighboring lines: lines `first`–`last` (0-based, `\n`-separated). */
interface Group {
  readonly first: number;
  readonly last: number;
  readonly spans: readonly Span[];
}

/** The text's `\n`-separated lines and where each starts; the last follows a final `\n`, if any. */
interface ModelLines {
  readonly texts: readonly string[];
  readonly starts: readonly number[];
}

interface GroupContext {
  readonly path: string;
  readonly text: string;
  readonly lines: ModelLines;
}

/** The edits as offsets in text order, or why they can't be. */
function spansFrom(file: FileTextEdits): Result<readonly Span[], string> {
  const lineStarts = lspLineStartsOf(file.text);
  const offsetOf = (position: LspPosition): number | undefined => {
    const start = lineStarts[position.line];
    if (start === undefined) {
      return undefined;
    }
    const next = lineStarts[position.line + 1] ?? file.text.length;
    const content = file.text.slice(start, next).replace(lineTerminator, '');
    return (
      start +
      convertCharacter(content, position.character, {
        from: file.encoding,
        to: positionEncodings.utf16,
      })
    );
  };
  const spans: Span[] = [];
  for (const edit of file.edits) {
    const start = offsetOf(edit.range.start);
    const end = offsetOf(edit.range.end);
    if (start === undefined || end === undefined) {
      return err('an edit is past the end of the file');
    }
    if (end < start) {
      return err('an edit ends before it starts');
    }
    spans.push({ start, end, newText: edit.newText });
  }
  const ordered = spans.toSorted((a, b) => a.start - b.start);
  for (const [index, span] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (previous !== undefined && span.start < previous.end) {
      return err('the edits overlap');
    }
  }
  return ok(ordered);
}

/** Where each LSP line starts: after `\r\n`, `\n` or `\r`. */
function lspLineStartsOf(text: string): readonly number[] {
  const starts = [0];
  for (const match of text.matchAll(lineTerminators)) {
    starts.push(match.index + match[0].length);
  }
  return starts;
}

function modelLinesOf(text: string): ModelLines {
  const texts = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of texts) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return { texts, starts };
}

/** The 0-based model line an offset is on. */
function lineAt(lines: ModelLines, offset: number): number {
  let low = 0;
  let high = lines.starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lines.starts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/** Spans in text order, grouped while no unchanged line lies between them. */
function groupsOf(spans: readonly Span[], lines: ModelLines): Group[] {
  const groups: Group[] = [];
  for (const span of spans) {
    const first = lineAt(lines, span.start);
    const last = lineAt(lines, span.end);
    const current = groups.at(-1);
    if (current !== undefined && first <= current.last + 1) {
      groups[groups.length - 1] = {
        first: current.first,
        last: Math.max(current.last, last),
        spans: [...current.spans, span],
      };
    } else {
      groups.push({ first, last, spans: [span] });
    }
  }
  return groups;
}

/**
 * A group's lines as one suggestion, with the lines it leaves as they were trimmed off both ends;
 * `undefined` when it changes nothing. A replacement of `''` is no lines, so one that leaves one
 * empty line takes the line after it along (else the one before); `unsayable` when there is none.
 */
function suggestionOf(
  group: Group,
  { path, text, lines }: GroupContext,
): UraSuggestionDraftView | 'unsayable' | undefined {
  const before = lines.texts.slice(group.first, group.last + 1);
  const groupStart = lines.starts[group.first] ?? 0;
  const groupEnd = (lines.starts[group.last] ?? 0) + (lines.texts[group.last] ?? '').length;
  let rewritten = '';
  let offset = groupStart;
  for (const span of group.spans) {
    rewritten += text.slice(offset, span.start) + span.newText;
    offset = span.end;
  }
  rewritten += text.slice(offset, groupEnd);
  const after = rewritten.split('\n');
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const startLine = group.first + prefix + 1;
  const endLine = group.last - suffix + 1;
  const replacement = after.slice(prefix, after.length - suffix);
  if (endLine < startLine && replacement.length === 0) {
    return undefined;
  }
  if (replacement.length !== 1 || replacement[0] !== '') {
    return { path, startLine, endLine, replacement: replacement.join('\n') };
  }
  const realLineCount = lines.texts.length - Number(text.endsWith('\n'));
  if (endLine < realLineCount) {
    const next = lines.texts[endLine] ?? '';
    return { path, startLine, endLine: endLine + 1, replacement: `\n${next}` };
  }
  if (startLine > 1) {
    const previous = lines.texts[startLine - 2] ?? '';
    return { path, startLine: startLine - 1, endLine, replacement: `${previous}\n` };
  }
  return 'unsayable';
}
