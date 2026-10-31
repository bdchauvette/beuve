import { createHash } from 'node:crypto';

import type { UraAnchorView } from '#contract/ipc-contract.ts';
import type { DiffFile, DiffHunk } from '#internal/git/diff-model.ts';
import { fenceCodeBlock } from '#internal/ura/fence-code-block.ts';
import { parseSuggestedPatch } from '#internal/ura/parse-suggested-patch.ts';

/** A staged line note written against the head the edits start from. */
export interface NoteAtHead {
  readonly itemId: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Its suggested patch, if it has one. */
  readonly suggestion: string | undefined;
}

/** What an earlier harvest made of a target: the item, and the content it carried. */
export interface HarvestedTarget {
  readonly itemId: string;
  readonly fingerprint: string;
}

/** Everything a harvest is a function of. */
export interface EditPlanInput {
  /** The edits from the reviewed head to the edits worktree, with no context lines. */
  readonly edits: readonly DiffFile[];
  /** The text at the reviewed head of each modified file, by path (files that are text). */
  readonly headTexts: ReadonlyMap<string, string>;
  /** The head lines the pull request added or changed, by path. */
  readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
  readonly notes: readonly NoteAtHead[];
  /** Earlier harvests at this head, by target. */
  readonly harvested: ReadonlyMap<string, HarvestedTarget>;
  /** The edits branch, named in each item's body. */
  readonly branch: string;
}

/** What staging one planned edit does. */
export type EditAction = 'create' | 'attach' | 'update' | 'unchanged';

/** One edit as the harvest would stage it. */
export interface PlannedEdit {
  /** Stable key for the edit's place: path and head lines, a file, or a new path. */
  readonly target: string;
  readonly anchor: UraAnchorView;
  /** `suggestion`: a suggested patch (ADR 0043); `note`: a note with a ` ```diff ` block. */
  readonly kind: 'suggestion' | 'note';
  readonly action: EditAction;
  /** The item it creates, attaches to or updates; absent for `create`. */
  readonly itemId?: string;
  readonly title: string;
  readonly body: string;
  /** The suggested patch, for `suggestion`. */
  readonly patch?: string;
  /** The edit as a unified diff, to preview: the patch, or the diff a note's block holds. */
  readonly diff: string;
  readonly fingerprint: string;
}

/** The harvest's plan, and a digest of it that confirming must name. */
export interface EditPlan {
  readonly edits: readonly PlannedEdit[];
  readonly digest: string;
}

const contextLines = 3;

/**
 * Turns review edits into URA items (ADR 0088). Each change region of a modified text file
 * (a `--unified=0` hunk) whose head lines are all lines the pull request changed becomes a
 * suggested patch over those lines, checked with `parseSuggestedPatch`: attached to a staged line
 * note at this head that covers it and carries no patch of its own (several regions in one note
 * become one patch over the note's lines), else a new note. A pure insertion becomes a
 * replacement of the line above it (of line 1 at the top of the file), as GitHub suggestions
 * express it. Everything else (edits to unchanged lines, new, deleted, renamed, binary or
 * mode-only files, and regions next to a missing final newline) becomes a note with a
 * ` ```diff ` block. An edit that an earlier harvest staged at the same target is `unchanged`
 * when its content is the same, else `update`s that item, so harvesting twice never duplicates.
 */
export function planEditSuggestions(input: EditPlanInput): EditPlan {
  const drafts = input.edits.flatMap((file) => draftsFor(file, input));
  const edits = drafts.map((draft) => decide(draft, input));
  const digest = createHash('sha256')
    .update(
      JSON.stringify(
        edits.map((edit) => {
          return [edit.target, edit.action, edit.fingerprint];
        }),
      ),
    )
    .digest('hex');
  return { edits, digest };
}

/** A planned edit before its action is known. */
interface Draft {
  readonly target: string;
  readonly anchor: UraAnchorView;
  readonly kind: 'suggestion' | 'note';
  readonly title: string;
  readonly body: string;
  readonly patch?: string;
  readonly diff: string;
  /** The note this suggestion attaches to, when one covers it. */
  readonly attachTo?: NoteAtHead;
}

function draftsFor(file: DiffFile, input: EditPlanInput): readonly Draft[] {
  if (file.status === 'added') {
    const title = `New file \`${file.path}\``;
    return [fileNote({ file, anchor: { kind: 'change' }, title }, input)];
  }
  if (file.status === 'deleted') {
    const title = `Delete \`${file.path}\``;
    return [fileNote({ file, anchor: { kind: 'file', path: file.path }, title }, input)];
  }
  if ('newPath' in file) {
    let verb = 'Copy';
    if (file.status === 'renamed') {
      verb = 'Rename';
    }
    const title = `${verb} \`${file.oldPath}\` to \`${file.newPath}\``;
    return [fileNote({ file, anchor: { kind: 'file', path: file.oldPath }, title }, input)];
  }
  const text = input.headTexts.get(file.path);
  if (text === undefined || file.binary || file.submodule || file.hunks.length === 0) {
    const title = `Change \`${file.path}\` (${describeKind(file)})`;
    return [fileNote({ file, anchor: { kind: 'file', path: file.path }, title }, input)];
  }
  return lineDrafts(file, { path: file.path, lines: splitLines(text) }, input);
}

function describeKind(file: DiffFile): string {
  if (file.binary) {
    return 'binary';
  }
  if (file.submodule) {
    return 'submodule';
  }
  if (file.hunks.length === 0) {
    return 'mode';
  }
  return 'not text';
}

/** A whole-file edit, where its note anchors, and what it is called. */
interface FileEdit {
  readonly file: DiffFile;
  readonly anchor: UraAnchorView;
  readonly title: string;
}

function fileNote({ file, anchor, title }: FileEdit, input: EditPlanInput): Draft {
  let target = 'change';
  if (anchor.kind === 'file') {
    target = `file:${anchor.path}`;
  }
  if (file.status === 'added') {
    target = `new:${file.path}`;
  }
  return {
    target,
    anchor,
    kind: 'note',
    title,
    body: noteBody({ text: file.patch }, input.branch),
    diff: file.patch,
  };
}

/** A modified file's head path and its lines. */
interface HeadFile {
  readonly path: string;
  readonly lines: readonly string[];
}

/** One change region on the head side: lines `start`–`end` become `replacement`. */
interface Region {
  readonly start: number;
  readonly end: number;
  readonly replacement: readonly string[];
  /** Git flagged a missing final newline in this hunk. */
  readonly isAtEndWithoutNewline: boolean;
}

function lineDrafts(file: DiffFile, head: HeadFile, input: EditPlanInput): readonly Draft[] {
  const changed = input.changedLines.get(head.path) ?? new Set<number>();
  const regions = file.hunks.map((hunk) => regionOf(hunk, head.lines));
  const notes = input.notes.filter((note) => note.path === head.path);
  const grouped = new Map<NoteAtHead | undefined, Region[]>();
  const drafts: Draft[] = [];
  for (const region of regions) {
    const isChanged = isWithin(region, changed) && !region.isAtEndWithoutNewline;
    if (!isChanged) {
      drafts.push(lineNote(region, head, input));
      continue;
    }
    const note = notes.find((candidate) => {
      return (
        candidate.startLine <= region.start &&
        candidate.endLine >= region.end &&
        isAttachable(candidate, input)
      );
    });
    grouped
      .getOrInsertComputed(note, () => {
        return [];
      })
      .push(region);
  }
  for (const [note, inside] of grouped) {
    if (note === undefined) {
      for (const region of inside) {
        drafts.push(suggestionDraft({ region, head, input, note: undefined }));
      }
      continue;
    }
    const merged: Region = {
      start: note.startLine,
      end: note.endLine,
      replacement: applyRegions(head.lines, { start: note.startLine, end: note.endLine }, inside),
      isAtEndWithoutNewline: false,
    };
    drafts.push(suggestionDraft({ region: merged, head, input, note }));
  }
  return drafts.toSorted((left, right) => left.target.localeCompare(right.target));
}

/** A note can take a harvested patch when it has none, or only one an earlier harvest gave it. */
function isAttachable(note: NoteAtHead, input: EditPlanInput): boolean {
  if (note.suggestion === undefined) {
    return true;
  }
  return input.harvested.values().some((harvest) => harvest.itemId === note.itemId);
}

function regionOf(hunk: DiffHunk, lines: readonly string[]): Region {
  const added = hunk.lines.filter((line) => line.kind === 'added').map((line) => line.content);
  const isAtEndWithoutNewline = hunk.lines.some((line) => line.noNewline);
  if (hunk.oldCount > 0) {
    return {
      start: hunk.oldStart,
      end: hunk.oldStart + hunk.oldCount - 1,
      replacement: added,
      isAtEndWithoutNewline,
    };
  }
  if (hunk.oldStart >= 1) {
    const above = lines[hunk.oldStart - 1] ?? '';
    return {
      start: hunk.oldStart,
      end: hunk.oldStart,
      replacement: [above, ...added],
      isAtEndWithoutNewline,
    };
  }
  return { start: 1, end: 1, replacement: [...added, lines[0] ?? ''], isAtEndWithoutNewline };
}

function isWithin(region: Region, changed: ReadonlySet<number>): boolean {
  for (let line = region.start; line <= region.end; line += 1) {
    if (!changed.has(line)) {
      return false;
    }
  }
  return true;
}

/** A range of head lines, 1-based and inclusive. */
interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** The lines of `range` with every region inside it applied. */
function applyRegions(
  lines: readonly string[],
  range: LineRange,
  regions: readonly Region[],
): string[] {
  const result: string[] = [];
  let line = range.start;
  const ordered = regions.toSorted((left, right) => left.start - right.start);
  for (const region of ordered) {
    while (line < region.start) {
      result.push(lines[line - 1] ?? '');
      line += 1;
    }
    result.push(...region.replacement);
    line = region.end + 1;
  }
  while (line <= range.end) {
    result.push(lines[line - 1] ?? '');
    line += 1;
  }
  return result;
}

/** What one suggestion is made from. */
interface SuggestionSource {
  readonly region: Region;
  readonly head: HeadFile;
  readonly input: EditPlanInput;
  readonly note: NoteAtHead | undefined;
}

function suggestionDraft({ region, head, input, note }: SuggestionSource): Draft {
  const anchor: UraAnchorView = {
    kind: 'lines',
    path: head.path,
    startLine: region.start,
    endLine: region.end,
  };
  const patch = buildPatch(head, region);
  const parsed = parseSuggestedPatch(patch, anchor);
  if (!parsed.ok) {
    return lineNote(region, head, input);
  }
  return {
    target: lineTarget(head.path, region),
    anchor,
    kind: 'suggestion',
    title: `Suggested change to ${describeLines(region)}`,
    body: `From review edits on \`${input.branch}\`.`,
    patch: parsed.value.text,
    diff: parsed.value.text,
    ...(note !== undefined && { attachTo: note }),
  };
}

function lineNote(region: Region, head: HeadFile, input: EditPlanInput): Draft {
  const diff = buildPatch(head, region);
  return {
    target: lineTarget(head.path, region),
    anchor: { kind: 'lines', path: head.path, startLine: region.start, endLine: region.end },
    kind: 'note',
    title: `Edit to ${describeLines(region)} (lines this change doesn't touch)`,
    body: noteBody({ text: diff }, input.branch),
    diff,
  };
}

function lineTarget(path: string, region: LineRange): string {
  return `lines:${path}:${String(region.start)}-${String(region.end)}`;
}

function describeLines(region: LineRange): string {
  if (region.start === region.end) {
    return `line ${String(region.start)}`;
  }
  return `lines ${String(region.start)}–${String(region.end)}`;
}

/** A note's body: where the edit came from, then its diff in a fenced block. */
function noteBody(diff: DiffText, branch: string): string {
  return `From review edits on \`${branch}\`:\n\n${fenceCodeBlock({ info: 'diff', content: diff.text })}`;
}

/** A unified diff, wrapped so a call can't swap it with the branch name. */
interface DiffText {
  readonly text: string;
}

/**
 * One hunk that removes the region's head lines and adds its replacement, with up to three
 * context lines and `--- a/` / `+++ b/` headers, as `buildSuggestedPatch` writes them (ADR 0043).
 */
function buildPatch(head: HeadFile, region: Region): string {
  const before = Math.max(1, region.start - contextLines);
  const after = Math.min(head.lines.length, region.end + contextLines);
  const out: string[] = [];
  for (let line = before; line < region.start; line += 1) {
    out.push(` ${head.lines[line - 1] ?? ''}`);
  }
  for (let line = region.start; line <= region.end; line += 1) {
    out.push(`-${head.lines[line - 1] ?? ''}`);
  }
  for (const added of region.replacement) {
    out.push(`+${added}`);
  }
  for (let line = region.end + 1; line <= after; line += 1) {
    out.push(` ${head.lines[line - 1] ?? ''}`);
  }
  const removedCount = region.end - region.start + 1;
  const oldCount = region.start - before + removedCount + (after - region.end);
  const newCount = region.start - before + region.replacement.length + (after - region.end);
  const newStart = before;
  const header = `@@ -${String(before)},${String(oldCount)} +${String(newStart)},${String(newCount)} @@`;
  return `--- a/${head.path}\n+++ b/${head.path}\n${header}\n${out.join('\n')}\n`;
}

/** A text's lines without their `\n` (a `\r` stays), with no phantom line after a final newline. */
function splitLines(text: string): readonly string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function decide(draft: Draft, input: EditPlanInput): PlannedEdit {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([draft.kind, draft.anchor, draft.patch ?? '', draft.body]))
    .digest('hex');
  const { attachTo, ...planned } = draft;
  const earlier = input.harvested.get(draft.target);
  if (earlier !== undefined) {
    let action: EditAction = 'update';
    if (earlier.fingerprint === fingerprint) {
      action = 'unchanged';
    }
    return { ...planned, fingerprint, action, itemId: earlier.itemId };
  }
  if (attachTo !== undefined) {
    let action: EditAction = 'attach';
    if (attachTo.suggestion === draft.patch) {
      action = 'unchanged';
    }
    return { ...planned, fingerprint, action, itemId: attachTo.itemId };
  }
  return { ...planned, fingerprint, action: 'create' };
}
