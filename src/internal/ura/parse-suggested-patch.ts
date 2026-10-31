import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { PatchHunk, PatchLine, SuggestedPatch, UraAnchor, UraItemError } from './ura-item.ts';
import { changeRegionsFrom } from './change-regions-from.ts';
import type { ChangeRegion } from './change-regions-from.ts';

type PatchError = Extract<UraItemError, { kind: 'invalid-patch' }>;

const hunkHeader = /^@@ -([\d,]+) \+([\d,]+) @@/u;
const noNewlineMarker = '\\';
const digits = /^\d{1,9}$/u;

/**
 * Validates a suggested patch against its item's anchor: a unified diff for the anchored path
 * only, whose hunks (for a line anchor) change only the anchored lines. File headers are optional
 * (`--- a/<path>` / `+++ b/<path>`, after an optional `diff --git` and `index` line); bare hunks
 * get them added. Whole-change anchors can't carry a patch.
 */
export function parseSuggestedPatch(
  text: string,
  anchor: UraAnchor,
): Result<SuggestedPatch, PatchError> {
  const invalid = (reason: string): Result<SuggestedPatch, PatchError> => {
    return err({ kind: 'invalid-patch', reason });
  };
  if (anchor.kind === 'change') {
    return invalid('a patch needs a file or line anchor');
  }
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  let index = skipPreamble(lines);
  const headers = readHeaders(lines, index, anchor.path);
  if (!headers.ok) {
    return invalid(headers.error);
  }
  index = headers.value;
  const bodyStart = index;
  const hunks: PatchHunk[] = [];
  while (index < lines.length) {
    const hunk = readHunk(lines, index);
    if (!hunk.ok) {
      return invalid(hunk.error);
    }
    hunks.push(hunk.value.hunk);
    index = hunk.value.next;
  }
  if (hunks.length === 0) {
    return invalid('the patch has no hunks');
  }
  const placement = checkPlacement(hunks, anchor);
  if (placement !== undefined) {
    return invalid(placement);
  }
  const body = lines.slice(bodyStart).join('\n');
  const normalized = `--- a/${anchor.path}\n+++ b/${anchor.path}\n${body}\n`;
  return ok({ path: anchor.path, text: normalized, hunks });
}

function skipPreamble(lines: readonly string[]): number {
  let index = 0;
  if (lines[index]?.startsWith('diff --git ') === true) {
    index += 1;
  }
  if (lines[index]?.startsWith('index ') === true) {
    index += 1;
  }
  return index;
}

function readHeaders(
  lines: readonly string[],
  index: number,
  path: string,
): Result<number, string> {
  const minus = lines[index];
  if (minus?.startsWith('--- ') !== true) {
    if (index === 0) {
      return ok(index);
    }
    return err('expected a "--- " header after the preamble');
  }
  const plus = lines[index + 1];
  if (plus?.startsWith('+++ ') !== true) {
    return err('a "--- " header must be followed by "+++ "');
  }
  const isPathHeader = (header: string, prefix: 'a/' | 'b/'): boolean => {
    return header === `${prefix}${path}` || header === path;
  };
  if (!isPathHeader(minus.slice(4), 'a/') || !isPathHeader(plus.slice(4), 'b/')) {
    return err(`the patch must change only ${path}`);
  }
  return ok(index + 2);
}

/** A hunk and the index of the line after it. */
interface HunkRead {
  readonly hunk: PatchHunk;
  readonly next: number;
}

function readHunk(lines: readonly string[], start: number): Result<HunkRead, string> {
  const header = lines[start] ?? '';
  if (header.startsWith('diff --git ') || header.startsWith('--- ')) {
    return err('the patch must change only one file');
  }
  const match = hunkHeader.exec(header);
  const oldSide = parseSide(match?.[1]);
  const newSide = parseSide(match?.[2]);
  if (oldSide === undefined || newSide === undefined) {
    return err(`line ${String(start + 1)} is not a hunk header`);
  }
  const [oldStart, oldCount] = oldSide;
  const [newStart, newCount] = newSide;
  let oldLeft = oldCount;
  let newLeft = newCount;
  let index = start + 1;
  const hunkLines: PatchLine[] = [];
  while (oldLeft > 0 || newLeft > 0) {
    const line = lines[index];
    if (line === undefined) {
      return err(`the hunk at line ${String(start + 1)} is shorter than its header says`);
    }
    index += 1;
    if (line.startsWith(noNewlineMarker)) {
      continue;
    }
    const kind = lineKind(line);
    if (kind === undefined) {
      return err(`line ${String(index)} is not a context, added or removed line`);
    }
    if (kind !== 'added') {
      oldLeft -= 1;
    }
    if (kind !== 'removed') {
      newLeft -= 1;
    }
    if (oldLeft < 0 || newLeft < 0) {
      return err(`the hunk at line ${String(start + 1)} is longer than its header says`);
    }
    hunkLines.push({ kind, content: line.slice(1) });
  }
  if (lines[index]?.startsWith(noNewlineMarker) === true) {
    index += 1;
  }
  return ok({ hunk: { oldStart, oldCount, newStart, newCount, lines: hunkLines }, next: index });
}

/** `12,3` → `[12, 3]`; a bare `12` counts one line. */
function parseSide(text: string | undefined): [number, number] | undefined {
  const parts = text?.split(',') ?? [];
  if (parts.length === 0 || parts.length > 2 || parts.some((part) => !digits.test(part))) {
    return undefined;
  }
  const [start, count = '1'] = parts;
  return [Number(start), Number(count)];
}

function lineKind(line: string): PatchLine['kind'] | undefined {
  // Some tools strip the space from empty context lines.
  if (line === '' || line.startsWith(' ')) {
    return 'context';
  }
  if (line.startsWith('+')) {
    return 'added';
  }
  if (line.startsWith('-')) {
    return 'removed';
  }
  return undefined;
}

function checkPlacement(hunks: readonly PatchHunk[], anchor: UraAnchor): string | undefined {
  let previousEnd = 0;
  for (const hunk of hunks) {
    let first = hunk.oldStart;
    if (hunk.oldCount === 0) {
      first += 1;
    }
    if (first <= previousEnd) {
      return 'hunks must be in order and must not overlap';
    }
    previousEnd = hunk.oldStart + Math.max(hunk.oldCount, 1) - 1;
  }
  const regions = hunks.flatMap((hunk) => changeRegionsFrom(hunk));
  if (regions.length === 0) {
    return 'the patch changes nothing';
  }
  if (anchor.kind !== 'lines') {
    return undefined;
  }
  const isInside = (region: ChangeRegion): boolean => {
    if (region.removed === 0) {
      return region.before >= anchor.startLine - 1 && region.before <= anchor.endLine;
    }
    return (
      region.before + 1 >= anchor.startLine && region.before + region.removed <= anchor.endLine
    );
  };
  if (regions.every((region) => isInside(region))) {
    return undefined;
  }
  return `the patch changes lines outside ${String(anchor.startLine)}–${String(anchor.endLine)}`;
}
