import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { DiffFile, DiffHunk, DiffLine, DiffParseError, FileChange } from './diff-model.ts';
import { unquoteGitPath } from './unquote-git-path.ts';

/**
 * Parses the output of `git diff` between two trees (`--src-prefix=a/ --dst-prefix=b/`, with
 * `core.quotepath=off`) into files, hunks and numbered lines. Pure; no I/O. Hunk bodies are read by
 * their line counts, so content that looks like a header can't derail parsing. Combined (merge)
 * diffs are rejected.
 */
export function parseUnifiedDiff(text: string): Result<readonly DiffFile[], DiffParseError> {
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const cursor: Cursor = { lines, index: 0 };
  const files: DiffFile[] = [];
  while (cursor.index < lines.length) {
    const file = parseFile(cursor);
    if (!file.ok) {
      return file;
    }
    files.push(file.value);
  }
  return ok(files);
}

interface Cursor {
  readonly lines: readonly string[];
  index: number;
}

/** What the extended header and `---`/`+++` lines said. A side is `devNull` when absent. */
interface Headers {
  oldMode?: string;
  newMode?: string;
  newFileMode?: string;
  deletedFileMode?: string;
  similarity?: number;
  renameFrom?: string;
  renameTo?: string;
  copyFrom?: string;
  copyTo?: string;
  oldObject?: string;
  newObject?: string;
  indexMode?: string;
  minusPath?: string;
  plusPath?: string;
  binary?: boolean;
}

const diffHeaderPrefix = 'diff --git ';
const devNull = '/dev/null';
const submoduleMode = '160000';

function parseFile(cursor: Cursor): Result<DiffFile, DiffParseError> {
  const start = cursor.index;
  const header = cursor.lines[start] ?? '';
  if (!header.startsWith(diffHeaderPrefix)) {
    const message = header.startsWith('diff --')
      ? 'combined diffs are not supported'
      : 'expected "diff --git"';
    return failure(cursor, message);
  }
  cursor.index += 1;

  const headers = parseExtendedHeaders(cursor);
  if (!headers.ok) {
    return headers;
  }
  const hunks = parseHunks(cursor);
  if (!hunks.ok) {
    return hunks;
  }
  const change = fileChange(header.slice(diffHeaderPrefix.length), headers.value);
  if (change === undefined) {
    return err({
      kind: 'malformed-diff',
      line: start + 1,
      message: 'cannot determine paths or modes',
    });
  }
  const { oldMode, newMode, newFileMode, deletedFileMode, indexMode } = headers.value;
  return ok({
    ...change,
    binary: headers.value.binary === true,
    submodule: [oldMode, newMode, newFileMode, deletedFileMode, indexMode].includes(submoduleMode),
    oldObject: headers.value.oldObject,
    newObject: headers.value.newObject,
    hunks: hunks.value,
    patch: `${cursor.lines.slice(start, cursor.index).join('\n')}\n`,
  });
}

function parseExtendedHeaders(cursor: Cursor): Result<Headers, DiffParseError> {
  let headers: Headers = {};
  for (;;) {
    const line = cursor.lines[cursor.index];
    if (line === undefined || line.startsWith(diffHeaderPrefix) || line.startsWith('@@ ')) {
      return ok(headers);
    }
    if (line.startsWith('--- ')) {
      return parsePathLines(cursor, headers);
    }
    const next = withHeader(headers, line);
    if (next === undefined) {
      return failure(cursor, `unexpected header line: ${line}`);
    }
    headers = next;
    cursor.index += 1;
  }
}

const binaryPattern = /^Binary files .* differ$/su;
const similarityPattern = /^(?:dis)?similarity index (\d+)%$/u;
const objectIdsPattern = /^([\da-f]+)\.\.([\da-f]+)$/u;
const modePattern = /^\d{6}$/u;

const headerFields: readonly (readonly [string, keyof Headers, 'mode' | 'path'])[] = [
  ['old mode ', 'oldMode', 'mode'],
  ['new mode ', 'newMode', 'mode'],
  ['new file mode ', 'newFileMode', 'mode'],
  ['deleted file mode ', 'deletedFileMode', 'mode'],
  ['rename from ', 'renameFrom', 'path'],
  ['rename to ', 'renameTo', 'path'],
  ['copy from ', 'copyFrom', 'path'],
  ['copy to ', 'copyTo', 'path'],
];

/** `headers` updated with one extended header line, or `undefined` if it isn't one. */
function withHeader(headers: Headers, line: string): Headers | undefined {
  if (binaryPattern.test(line)) {
    return { ...headers, binary: true };
  }
  if (line.startsWith('index ')) {
    return withIndexLine(headers, line.slice('index '.length));
  }
  const similarity = similarityPattern.exec(line);
  if (similarity !== null) {
    return { ...headers, similarity: Number(similarity[1]) };
  }
  for (const [prefix, key, type] of headerFields) {
    if (!line.startsWith(prefix)) {
      continue;
    }
    const raw = line.slice(prefix.length);
    const value = type === 'path' ? unquoteGitPath(raw) : raw;
    if (value === undefined || (type === 'mode' && !modePattern.test(value))) {
      return undefined;
    }
    return { ...headers, [key]: value };
  }
  return undefined;
}

/** `index <old>..<new>[ <mode>]`; the mode appears only when both sides share it. */
function withIndexLine(headers: Headers, rest: string): Headers | undefined {
  const [ids = '', mode, ...extra] = rest.split(' ');
  const match = objectIdsPattern.exec(ids);
  if (match === null || extra.length > 0 || (mode !== undefined && !modePattern.test(mode))) {
    return undefined;
  }
  const [, oldObject = '', newObject = ''] = match;
  const objects = { ...headers, oldObject, newObject };
  if (mode === undefined) {
    return objects;
  }
  return { ...objects, indexMode: mode };
}

function parsePathLines(cursor: Cursor, headers: Headers): Result<Headers, DiffParseError> {
  const minus = sidePath(cursor.lines[cursor.index]?.slice(4) ?? '', 'a/');
  const plusLine = cursor.lines[cursor.index + 1] ?? '';
  const plus = plusLine.startsWith('+++ ') ? sidePath(plusLine.slice(4), 'b/') : undefined;
  if (minus === undefined || plus === undefined) {
    return failure(cursor, 'malformed "---"/"+++" lines');
  }
  cursor.index += 2;
  return ok({ ...headers, minusPath: minus, plusPath: plus });
}

/** The path, or {@link devNull}. Git appends a tab to names containing spaces, for GNU patch. */
function sidePath(raw: string, prefix: string): string | undefined {
  const name = raw.endsWith('\t') ? raw.slice(0, -1) : raw;
  if (name === devNull) {
    return devNull;
  }
  const decoded = unquoteGitPath(name);
  if (decoded?.startsWith(prefix) === true) {
    return decoded.slice(prefix.length);
  }
  return undefined;
}

function parseHunks(cursor: Cursor): Result<readonly DiffHunk[], DiffParseError> {
  const hunks: DiffHunk[] = [];
  for (;;) {
    const line = cursor.lines[cursor.index];
    if (line === undefined || line.startsWith(diffHeaderPrefix)) {
      return ok(hunks);
    }
    const hunk = parseHunk(cursor);
    if (!hunk.ok) {
      return hunk;
    }
    hunks.push(hunk.value);
  }
}

const hunkHeaderPattern = /^@@ -(\S+) \+(\S+) @@(.*)$/su;
const digitsPattern = /^\d+$/u;

function parseHunk(cursor: Cursor): Result<DiffHunk, DiffParseError> {
  const header = cursor.lines[cursor.index] ?? '';
  const match = hunkHeaderPattern.exec(header);
  const oldRange = parseRange(match?.[1]);
  const newRange = parseRange(match?.[2]);
  if (oldRange === undefined || newRange === undefined) {
    return failure(cursor, `expected a hunk header: ${header}`);
  }
  cursor.index += 1;
  const lines = parseHunkLines(cursor, oldRange, newRange);
  if (!lines.ok) {
    return lines;
  }
  return ok({
    oldStart: oldRange.start,
    oldCount: oldRange.count,
    newStart: newRange.start,
    newCount: newRange.count,
    header,
    section: withoutLeadingSpace(match?.[3] ?? ''),
    lines: lines.value,
  });
}

function withoutLeadingSpace(text: string): string {
  if (text.startsWith(' ')) {
    return text.slice(1);
  }
  return text;
}

interface Range {
  readonly start: number;
  readonly count: number;
}

/** `start[,count]`, where a missing count means 1. */
function parseRange(text = ''): Range | undefined {
  const [start = '', count = '1', ...extra] = text.split(',');
  if (extra.length > 0 || !digitsPattern.test(start) || !digitsPattern.test(count)) {
    return undefined;
  }
  return { start: Number(start), count: Number(count) };
}

function parseHunkLines(
  cursor: Cursor,
  oldRange: Range,
  newRange: Range,
): Result<readonly DiffLine[], DiffParseError> {
  const lines: DiffLine[] = [];
  let oldLine = oldRange.start;
  let newLine = newRange.start;
  let oldRemaining = oldRange.count;
  let newRemaining = newRange.count;

  for (;;) {
    const line = cursor.lines[cursor.index];
    if (line?.startsWith('\\') === true) {
      const last = lines.pop();
      if (last === undefined) {
        return failure(cursor, '"\\ No newline" marker before any line');
      }
      lines.push({ ...last, noNewline: true });
      cursor.index += 1;
      continue;
    }
    if (oldRemaining === 0 && newRemaining === 0) {
      return ok(lines);
    }
    if (line === undefined) {
      return failure(cursor, 'hunk ended before its line counts were met');
    }
    const marker = line.charAt(0);
    const content = line.slice(1);
    // An empty line is a blank context line when `diff.suppressBlankEmpty` is set.
    if ((marker === ' ' || line === '') && oldRemaining > 0 && newRemaining > 0) {
      lines.push({ kind: 'context', content, oldLine, newLine, noNewline: false });
      oldLine += 1;
      newLine += 1;
      oldRemaining -= 1;
      newRemaining -= 1;
    } else if (marker === '-' && oldRemaining > 0) {
      lines.push({ kind: 'removed', content, oldLine, noNewline: false });
      oldLine += 1;
      oldRemaining -= 1;
    } else if (marker === '+' && newRemaining > 0) {
      lines.push({ kind: 'added', content, newLine, noNewline: false });
      newLine += 1;
      newRemaining -= 1;
    } else {
      return failure(cursor, `line does not fit the hunk's counts: ${line}`);
    }
    cursor.index += 1;
  }
}

function fileChange(headerPaths: string, headers: Headers): FileChange | undefined {
  const fallback = headerPathPair(headerPaths);
  const oldPath = headers.minusPath ?? fallback?.[0];
  const newPath = headers.plusPath ?? fallback?.[1];
  if (headers.newFileMode !== undefined) {
    if (isRealPath(newPath)) {
      return { status: 'added', path: newPath, mode: headers.newFileMode };
    }
    return undefined;
  }
  if (headers.deletedFileMode !== undefined) {
    if (isRealPath(oldPath)) {
      return { status: 'deleted', path: oldPath, mode: headers.deletedFileMode };
    }
    return undefined;
  }
  return movedOrModified(headers, newPath);
}

function movedOrModified(headers: Headers, path: string | undefined): FileChange | undefined {
  const oldMode = headers.oldMode ?? headers.indexMode;
  const newMode = headers.newMode ?? headers.indexMode;
  if (headers.renameFrom !== undefined && headers.renameTo !== undefined) {
    return {
      status: 'renamed',
      oldPath: headers.renameFrom,
      newPath: headers.renameTo,
      similarity: headers.similarity ?? 100,
      oldMode,
      newMode,
    };
  }
  if (headers.copyFrom !== undefined && headers.copyTo !== undefined) {
    return {
      status: 'copied',
      oldPath: headers.copyFrom,
      newPath: headers.copyTo,
      similarity: headers.similarity ?? 100,
      oldMode,
      newMode,
    };
  }
  if (oldMode === undefined || newMode === undefined || !isRealPath(path)) {
    return undefined;
  }
  return { status: 'modified', path, oldMode, newMode };
}

function isRealPath(path: string | undefined): path is string {
  return path !== undefined && path !== devNull;
}

/**
 * Paths from `a/<old> b/<new>` when no `---`/`+++` lines exist (binary, empty or mode-only
 * changes). Unquoted names with spaces are ambiguous in general, but in those cases both sides
 * name the same file, so the line splits evenly.
 */
function headerPathPair(text: string): readonly [string, string] | undefined {
  const strip = (side: string | undefined, prefix: string): string | undefined => {
    if (side?.startsWith(prefix) === true) {
      return side.slice(prefix.length);
    }
    return undefined;
  };
  const pair = splitHeaderPaths(text);
  const oldPath = strip(unquoteGitPath(pair?.[0] ?? ''), 'a/');
  const newPath = strip(unquoteGitPath(pair?.[1] ?? ''), 'b/');
  if (oldPath === undefined || newPath === undefined) {
    return undefined;
  }
  return [oldPath, newPath];
}

function splitHeaderPaths(text: string): readonly [string, string] | undefined {
  if (text.startsWith('"')) {
    const close = closingQuote(text);
    if (close === undefined) {
      return undefined;
    }
    return [text.slice(0, close + 1), text.slice(close + 2)];
  }
  if (text.endsWith('"')) {
    const open = text.lastIndexOf(' "b/');
    if (open === -1) {
      return undefined;
    }
    return [text.slice(0, open), text.slice(open + 1)];
  }
  const half = (text.length - 1) / 2;
  const isEvenSplit =
    Number.isSafeInteger(half) &&
    text.charAt(half) === ' ' &&
    text.slice(2, half) === text.slice(half + 3);
  const separator = isEvenSplit ? half : text.indexOf(' b/');
  if (separator === -1) {
    return undefined;
  }
  return [text.slice(0, separator), text.slice(separator + 1)];
}

function closingQuote(text: string): number | undefined {
  for (let index = 1; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '\\') {
      index += 1;
    } else if (char === '"') {
      return index;
    }
  }
  return undefined;
}

function failure(cursor: Cursor, message: string): Result<never, DiffParseError> {
  return err({ kind: 'malformed-diff', line: cursor.index + 1, message });
}
