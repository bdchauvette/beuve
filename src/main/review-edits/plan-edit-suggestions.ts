import { createHash } from 'node:crypto';

import type {
  UraAnchorView,
  UraSeverityView,
  UraSuggestionDraftView,
} from '#contract/ipc-contract.ts';
import type { DiffFile, DiffHunk } from '#internal/git/diff-model.ts';
import { fenceCodeBlock } from '#internal/ura/fence-code-block.ts';
import { suggestedPatchFrom } from '#internal/ura/suggested-patch-from.ts';
import { uraSuggestionLimits } from '#internal/ura/ura-suggestion-limits.ts';

/** A staged line note written against the head the edits start from. */
export interface NoteAtHead {
  readonly itemId: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly title: string;
  /** Its suggestions, with their ids; none when it has none. */
  readonly suggestions: readonly UraSuggestionDraftView[];
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
  readonly notes: readonly NoteAtHead[];
  /** Earlier harvests at this head, by target. */
  readonly harvested: ReadonlyMap<string, HarvestedTarget>;
  /** The edits branch, named in each item's body. */
  readonly branch: string;
}

/** What staging one planned edit does. */
export type EditAction = 'create' | 'attach' | 'update' | 'unchanged';

/** One change region as a suggestion, and its derived patch to preview. */
export interface HarvestedSuggestion {
  readonly suggestion: UraSuggestionDraftView;
  readonly diff: string;
}

/** One item as the harvest would stage it. */
export interface PlannedEdit {
  /**
   * Stable key for the item: `note:<id>` for the suggestions attached to a staged note,
   * `suggestions:<path>` for a file's new note of suggestions, else the place of a note with a
   * diff (a file, a new path, or head lines whose final newline changes).
   */
  readonly target: string;
  readonly anchor: UraAnchorView;
  /** `suggestions`: a note's list of suggestions (ADR 0162); `note`: a note with a ` ```diff ` block. */
  readonly kind: 'suggestions' | 'note';
  readonly action: EditAction;
  /** The item it attaches to or updates; absent for `create`. */
  readonly itemId?: string;
  readonly severity: UraSeverityView;
  readonly title: string;
  readonly body: string;
  /** The suggestions, for `suggestions`; ids of the ones the item has on the same lines are kept. */
  readonly suggestions: readonly HarvestedSuggestion[];
  /** The diff a note's block holds; `''` for `suggestions`. */
  readonly diff: string;
  readonly fingerprint: string;
}

/** The harvest's plan, and a digest of it that confirming must name. */
export interface EditPlan {
  readonly edits: readonly PlannedEdit[];
  readonly digest: string;
}

/**
 * Turns review edits into URA items (ADR 0088, as ADR 0162 amends it). Every change region of a
 * modified text file (a `--unified=0` hunk) becomes a suggestion, whether or not the pull request
 * changed those lines: the regions a staged line note at this head covers are attached to it,
 * when it has no suggestions or only ones an earlier harvest gave it; the rest of a file's regions
 * become one new note labeled `suggestion`, anchored at its first region. A region that adds or
 * removes the file's final newline, which a suggestion can't say, and whole-file edits (new,
 * deleted, renamed, copied, binary, submodule and mode-only files) become notes with a
 * ` ```diff ` block. An item that an earlier harvest staged at the same target is `unchanged`
 * when its content is the same, else `update`d, so harvesting twice never duplicates.
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

/** A planned item before its action is known. */
interface Draft {
  readonly target: string;
  readonly anchor: UraAnchorView;
  readonly kind: 'suggestions' | 'note';
  readonly severity: UraSeverityView;
  readonly title: string;
  readonly body: string;
  readonly suggestions: readonly HarvestedSuggestion[];
  readonly diff: string;
  /** The staged note these suggestions attach to. */
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
  return lineDrafts(file, { path: file.path, text, lines: splitLines(text) }, input);
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
    severity: 'issue',
    title,
    body: noteBody({ text: file.patch }, input.branch),
    suggestions: [],
    diff: file.patch,
  };
}

/** A modified file's head path, its text and its lines. */
interface HeadFile {
  readonly path: string;
  readonly text: string;
  readonly lines: readonly string[];
}

/**
 * One change region on the head side: lines `start`–`end` become `replacement`; `end` is
 * `start - 1` for an insertion before `start`.
 */
interface Region {
  readonly start: number;
  readonly end: number;
  readonly replacement: readonly string[];
  /** Whether the edit adds or removes the file's final newline in this hunk. */
  readonly isNewlineChanged: boolean;
}

/** A region's suggestion, and the head lines a note must cover to take it. */
interface Placed {
  readonly kind: 'placed';
  readonly harvested: HarvestedSuggestion;
  readonly span: LineRange;
}

/** Why a region is a note with a diff instead: what its title says after its lines. */
interface Unsayable {
  readonly kind: 'unsayable';
  readonly why: string;
}

const { maxSuggestions, maxReplacementBytes } = uraSuggestionLimits;

function lineDrafts(file: DiffFile, head: HeadFile, input: EditPlanInput): readonly Draft[] {
  const notes = input.notes.filter((note) => {
    return note.path === head.path && isAttachable(note, input);
  });
  const attached = new Map<NoteAtHead, Placed[]>();
  const loose: Placed[] = [];
  const drafts: Draft[] = [];
  for (const hunk of file.hunks) {
    const region = regionOf(hunk);
    const placed = placedOf(region, head);
    if (placed.kind === 'unsayable') {
      drafts.push(lineNote({ region, why: placed.why }, head, input));
      continue;
    }
    const note = notes.find((candidate) => {
      return candidate.startLine <= placed.span.start && candidate.endLine >= placed.span.end;
    });
    if (note === undefined) {
      loose.push(placed);
      continue;
    }
    const inside = attached.getOrInsertComputed(note, () => {
      return [];
    });
    // A note full to the item limit leaves the rest to the file's new notes.
    if (inside.length >= maxSuggestions) {
      loose.push(placed);
      continue;
    }
    inside.push(placed);
  }
  for (const [note, inside] of attached) {
    drafts.push(attachDraft(note, inside));
  }
  const groups = chunksOf(loose, maxSuggestions);
  for (const [index, group] of groups.entries()) {
    drafts.push(groupDraft({ head, group, index, count: groups.length }, input));
  }
  return drafts;
}

/** `items` in runs of at most `size`, in order. */
function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * A note can take harvested suggestions when it has none, or only ones an earlier harvest gave
 * it; a note a harvest created for a file's suggestions never takes another's.
 */
function isAttachable(note: NoteAtHead, input: EditPlanInput): boolean {
  let isHarvested = false;
  for (const [target, harvest] of input.harvested) {
    if (harvest.itemId !== note.itemId) {
      continue;
    }
    if (target.startsWith(groupPrefix)) {
      return false;
    }
    isHarvested = true;
  }
  return note.suggestions.length === 0 || isHarvested;
}

function regionOf(hunk: DiffHunk): Region {
  const added = hunk.lines.filter((line) => line.kind === 'added');
  const isAddedWithoutNewline = added.some((line) => line.noNewline);
  const isRemovedWithoutNewline = hunk.lines.some((line) => {
    return line.kind === 'removed' && line.noNewline;
  });
  const replacement = added.map((line) => line.content);
  const isNewlineChanged = isAddedWithoutNewline !== isRemovedWithoutNewline;
  if (hunk.oldCount > 0) {
    const end = hunk.oldStart + hunk.oldCount - 1;
    return { start: hunk.oldStart, end, replacement, isNewlineChanged };
  }
  return { start: hunk.oldStart + 1, end: hunk.oldStart, replacement, isNewlineChanged };
}

/**
 * The region as a suggestion with its derived patch, unless a suggestion can't say it: a change
 * to the final newline, a replacement over the item limit's 64 KiB, or one empty line inserted
 * into an empty file.
 */
function placedOf(region: Region, head: HeadFile): Placed | Unsayable {
  if (region.isNewlineChanged) {
    return { kind: 'unsayable', why: 'its final newline changes' };
  }
  const suggestion = suggestionOf(region, head);
  if (suggestion === undefined) {
    return { kind: 'unsayable', why: 'a suggestion can’t say it' };
  }
  if (new TextEncoder().encode(suggestion.replacement).length > maxReplacementBytes) {
    return { kind: 'unsayable', why: 'too large for a suggestion' };
  }
  const patch = suggestedPatchFrom(head.text, suggestion);
  if (!patch.ok) {
    return { kind: 'unsayable', why: 'a suggestion can’t say it' };
  }
  let span: LineRange = { start: region.start, end: region.end };
  if (region.end < region.start) {
    const line = Math.max(1, region.start - 1);
    span = { start: line, end: line };
  }
  return { kind: 'placed', harvested: { suggestion, diff: patch.value }, span };
}

/**
 * The region as a suggestion. A replacement of `''` is no lines, so a region that leaves or
 * inserts one empty line takes a head line next to it along (the one after, else the one before);
 * an empty line inserted into an empty file has none, and no suggestion.
 */
function suggestionOf(region: Region, head: HeadFile): UraSuggestionDraftView | undefined {
  const { path, lines } = head;
  const replacement = region.replacement.join('\n');
  const isOneEmptyLine = region.replacement.length === 1 && replacement === '';
  if (!isOneEmptyLine) {
    return { path, startLine: region.start, endLine: region.end, replacement };
  }
  if (region.end < lines.length) {
    const after = lines[region.end] ?? '';
    return { path, startLine: region.start, endLine: region.end + 1, replacement: `\n${after}` };
  }
  if (region.start > 1) {
    const before = lines[region.start - 2] ?? '';
    return { path, startLine: region.start - 1, endLine: region.end, replacement: `${before}\n` };
  }
  return undefined;
}

function attachDraft(note: NoteAtHead, inside: readonly Placed[]): Draft {
  let title = 'the note';
  if (note.title !== '') {
    title = `“${note.title}”`;
  }
  return {
    target: `note:${note.itemId}`,
    anchor: { kind: 'lines', path: note.path, startLine: note.startLine, endLine: note.endLine },
    kind: 'suggestions',
    severity: 'suggestion',
    title: `${describeCount(inside.length)} for ${title}`,
    body: '',
    suggestions: inside.map((placed) => placed.harvested),
    diff: '',
    attachTo: note,
  };
}

/**
 * Some of a file's regions that no staged note takes: group `index` of `count`, each at most
 * the item limit's 500 suggestions.
 */
interface LooseRegions {
  readonly head: HeadFile;
  readonly group: readonly Placed[];
  readonly index: number;
  readonly count: number;
}

/**
 * A new note of a file's suggestions, anchored at its first region. A file with more than 500 has
 * several, each its own target (`suggestions:<path>`, then `suggestions:<path>#2`, …).
 */
function groupDraft({ head, group, index, count }: LooseRegions, input: EditPlanInput): Draft {
  const span = group[0]?.span ?? { start: 1, end: 1 };
  let target = `${groupPrefix}${head.path}`;
  let title = `Suggested changes to \`${head.path}\``;
  if (index > 0) {
    target += `#${String(index + 1)}`;
  }
  if (count > 1) {
    title += ` (${String(index + 1)} of ${String(count)})`;
  }
  return {
    target,
    anchor: { kind: 'lines', path: head.path, startLine: span.start, endLine: span.end },
    kind: 'suggestions',
    severity: 'suggestion',
    title,
    body: `From review edits on \`${input.branch}\`.`,
    suggestions: group.map((placed) => placed.harvested),
    diff: '',
  };
}

const groupPrefix = 'suggestions:';

function describeCount(count: number): string {
  if (count === 1) {
    return 'Suggested change';
  }
  return `${String(count)} suggested changes`;
}

/** A region a suggestion can't say, and why. */
interface UnsayableRegion {
  readonly region: Region;
  readonly why: string;
}

function lineNote({ region, why }: UnsayableRegion, head: HeadFile, input: EditPlanInput): Draft {
  const diff = buildPatch(head, region);
  const start = Math.max(1, Math.min(region.start, region.end));
  const end = Math.max(start, region.end);
  return {
    target: lineTarget(head.path, { start, end }),
    anchor: { kind: 'lines', path: head.path, startLine: start, endLine: end },
    kind: 'note',
    severity: 'issue',
    title: `Edit to ${describeLines({ start, end })} (${why})`,
    body: noteBody({ text: diff }, input.branch),
    suggestions: [],
    diff,
  };
}

/** A range of head lines, 1-based and inclusive. */
interface LineRange {
  readonly start: number;
  readonly end: number;
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

const contextLines = 3;

/**
 * One hunk that removes the region's head lines and adds its replacement, with up to three
 * context lines and `--- a/` / `+++ b/` headers, for a note's diff block.
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
  const header = `@@ -${String(before)},${String(oldCount)} +${String(before)},${String(newCount)} @@`;
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
    .update(
      JSON.stringify([
        draft.kind,
        draft.anchor,
        draft.suggestions.map(({ suggestion }) => suggestion),
        draft.body,
      ]),
    )
    .digest('hex');
  const { attachTo, ...planned } = draft;
  const earlier = input.harvested.get(draft.target);
  if (earlier !== undefined) {
    let action: EditAction = 'update';
    if (earlier.fingerprint === fingerprint) {
      action = 'unchanged';
    }
    const owner = input.notes.find((note) => note.itemId === earlier.itemId);
    return {
      ...planned,
      suggestions: withKeptIds(planned.suggestions, owner),
      fingerprint,
      action,
      itemId: earlier.itemId,
    };
  }
  if (attachTo !== undefined) {
    let action: EditAction = 'attach';
    if (isSameSuggestions(attachTo.suggestions, planned.suggestions)) {
      action = 'unchanged';
    }
    return {
      ...planned,
      suggestions: withKeptIds(planned.suggestions, attachTo),
      fingerprint,
      action,
      itemId: attachTo.itemId,
    };
  }
  return { ...planned, fingerprint, action: 'create' };
}

/** Each suggestion with the id of the one `note` has on the same lines, so it keeps its postings. */
function withKeptIds(
  suggestions: readonly HarvestedSuggestion[],
  note: NoteAtHead | undefined,
): readonly HarvestedSuggestion[] {
  if (note === undefined) {
    return suggestions;
  }
  return suggestions.map((harvested): HarvestedSuggestion => {
    const { suggestion } = harvested;
    const same = note.suggestions.find((own) => {
      return (
        own.path === suggestion.path &&
        own.startLine === suggestion.startLine &&
        own.endLine === suggestion.endLine
      );
    });
    if (same?.id === undefined) {
      return harvested;
    }
    return { ...harvested, suggestion: { ...suggestion, id: same.id } };
  });
}

function isSameSuggestions(
  own: readonly UraSuggestionDraftView[],
  planned: readonly HarvestedSuggestion[],
): boolean {
  return (
    own.length === planned.length &&
    own.every((suggestion, index) => {
      const other = planned[index]?.suggestion;
      return (
        suggestion.path === other?.path &&
        suggestion.startLine === other.startLine &&
        suggestion.endLine === other.endLine &&
        suggestion.replacement === other.replacement
      );
    })
  );
}
