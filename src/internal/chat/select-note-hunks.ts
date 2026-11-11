import type { ChatFile } from './chat-question.ts';
import type { NoteAnchor } from './note-draft.ts';
import { parseHunkRanges } from './parse-hunk-ranges.ts';
import type { HeadRange } from './parse-hunk-ranges.ts';
import { splitPatchHunks } from './split-patch-hunks.ts';

/** Size limits for a note's diff, in UTF-16 characters (string length). */
export interface NoteDiffBudget {
  /** Every section's patch together. */
  readonly maxChars: number;
  /** One file's patch, so one file can't fill a whole-change note's diff. */
  readonly maxFileChars: number;
}

/** One file's part of a note's diff: its preamble and the chosen hunks, in diff order. */
export interface NoteDiffSection {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: ChatFile['status'];
  readonly patch: string;
  readonly shownHunks: number;
  readonly totalHunks: number;
  /** Whether the only hunk shown was cut short to fit. */
  readonly isCut: boolean;
}

/** The diff a note's draft is written against (ADR 0125). */
export interface NoteDiffSelection {
  readonly sections: readonly NoteDiffSection[];
  /** Files of a whole-change note left out for size, or because they are binary. */
  readonly omittedPaths: readonly string[];
}

/** Hunks this many head lines from the anchored ones still count as its neighbors. */
const neighborLines = 20;
const afterNewline = /(?<=\n)/u;

/**
 * The hunks a note's draft needs (ADR 0125): for a line note, the anchored file's hunks that
 * touch or neighbor the anchored lines (the nearest one when none do), nearest first while they
 * fit; for a file note, the file's hunks in order; for a whole-change note, each file's leading
 * hunks in diff order while they fit. Binary files are never shown. Pure.
 */
export function selectNoteHunks(
  files: readonly ChatFile[],
  anchor: NoteAnchor,
  budget: NoteDiffBudget,
): NoteDiffSelection {
  if (anchor.kind === 'change') {
    return selectChangeHunks(files, budget);
  }
  const file = files.find((candidate) => candidate.path === anchor.path && !candidate.binary);
  if (file === undefined) {
    return { sections: [], omittedPaths: [] };
  }
  const { preamble, hunks } = splitPatchHunks(file.patch);
  let preferred = hunks.map((_hunk, index) => index);
  if (anchor.kind === 'lines') {
    preferred = nearbyHunks(hunks, anchor);
  }
  const room = Math.min(budget.maxChars, budget.maxFileChars) - preamble.length;
  const chosen = new Set<number>();
  let used = 0;
  for (const index of preferred) {
    const hunk = hunks[index] ?? '';
    if (used + hunk.length > room) {
      continue;
    }
    chosen.add(index);
    used += hunk.length;
  }
  const shown = hunks.filter((_hunk, index) => chosen.has(index));
  if (shown.length > 0) {
    return {
      sections: [
        {
          ...sectionOf(file, preamble + shown.join('')),
          shownHunks: shown.length,
          totalHunks: hunks.length,
        },
      ],
      omittedPaths: [],
    };
  }
  const [first] = preferred;
  if (first === undefined || room <= 0) {
    return { sections: [], omittedPaths: [] };
  }
  const cut = cutHunk(hunks[first] ?? '', room);
  return {
    sections: [
      {
        ...sectionOf(file, preamble + cut),
        shownHunks: 1,
        totalHunks: hunks.length,
        isCut: true,
      },
    ],
    omittedPaths: [],
  };
}

function selectChangeHunks(files: readonly ChatFile[], budget: NoteDiffBudget): NoteDiffSelection {
  const sections: NoteDiffSection[] = [];
  const omittedPaths: string[] = [];
  let remaining = budget.maxChars;
  for (const file of files) {
    if (file.binary) {
      omittedPaths.push(file.path);
      continue;
    }
    const { preamble, hunks } = splitPatchHunks(file.patch);
    const shown = leadingHunksWithin(
      hunks,
      Math.min(budget.maxFileChars, remaining) - preamble.length,
    );
    const patch = preamble + hunks.slice(0, shown).join('');
    if (shown === 0 && hunks.length > 0) {
      omittedPaths.push(file.path);
      continue;
    }
    sections.push({ ...sectionOf(file, patch), shownHunks: shown, totalHunks: hunks.length });
    remaining -= patch.length;
  }
  return { sections, omittedPaths };
}

/** How many of `hunks`, from the first, fit in `room` characters together. */
function leadingHunksWithin(hunks: readonly string[], room: number): number {
  let used = 0;
  const fitting = hunks.findIndex((hunk) => {
    used += hunk.length;
    return used > room;
  });
  if (fitting === -1) {
    return hunks.length;
  }
  return fitting;
}

/** A file's section fields but the hunk counts. */
type SectionHead = Omit<NoteDiffSection, 'shownHunks' | 'totalHunks'>;

function sectionOf(file: ChatFile, patch: string): SectionHead {
  return {
    path: file.path,
    ...(file.previousPath !== undefined && { previousPath: file.previousPath }),
    status: file.status,
    patch,
    isCut: false,
  };
}

/** The indexes of the hunks near the anchored lines, nearest first; the nearest when none is. */
function nearbyHunks(
  hunks: readonly string[],
  anchor: Extract<NoteAnchor, { kind: 'lines' }>,
): number[] {
  const distances = hunks.map((hunk, index): HunkDistance => {
    const [range] = parseHunkRanges(hunk);
    return { index, distance: distanceOf(range, anchor) };
  });
  const byDistance = distances.toSorted((a, b) => a.distance - b.distance);
  const near = byDistance.filter((entry) => entry.distance <= neighborLines);
  if (near.length > 0) {
    return near.map((entry) => entry.index);
  }
  return byDistance.slice(0, 1).map((entry) => entry.index);
}

/** A hunk's index, and how many head lines lie between it and the anchored lines. */
interface HunkDistance {
  readonly index: number;
  readonly distance: number;
}

function distanceOf(
  range: HeadRange | undefined,
  anchor: Extract<NoteAnchor, { kind: 'lines' }>,
): number {
  if (range === undefined) {
    return Infinity;
  }
  if (range.end < anchor.startLine) {
    return anchor.startLine - range.end;
  }
  if (range.start > anchor.endLine) {
    return range.start - anchor.endLine;
  }
  return 0;
}

/** The hunk's leading whole lines that fit in `room` characters (at least its header). */
function cutHunk(hunk: string, room: number): string {
  let kept = '';
  for (const line of hunk.split(afterNewline)) {
    if (kept !== '' && kept.length + line.length > room) {
      break;
    }
    kept += line;
  }
  return kept;
}
