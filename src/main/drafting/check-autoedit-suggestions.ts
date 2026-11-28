import type {
  AutoeditSuggestionDraftView,
  AutoeditSuggestionView,
} from '#contract/ipc-contract.ts';
import type { ShownLines } from '#internal/chat/build-note-draft-prompt.ts';
import { noteSuggestionIdFrom } from '#internal/chat/note-suggestion-id-from.ts';
import type { UraHeadTexts } from '#internal/ura/compile-ura-artifact.ts';
import { uraSuggestionLimits } from '#internal/ura/ura-suggestion-limits.ts';

import { checkSuggestionRanges } from '../ura/check-suggestion-ranges.ts';
import type { ProposedSuggestion } from './parse-autoedit-answer.ts';

/** What an autoedit answer's suggestions are checked against. */
export interface AutoeditSuggestionContext {
  /** The draft's suggestions as sent, in order: the prompt's s1, s2, …. */
  readonly existing: readonly AutoeditSuggestionDraftView[];
  /** The head lines the prompt showed. */
  readonly shownLines: readonly ShownLines[];
  readonly headSha: string;
  /** The text of every file the answer's suggestions name, at `headSha`. */
  readonly texts: UraHeadTexts;
}

/** The suggestions an autoedit keeps, and how many it proposed that were left out. */
export interface CheckedAutoeditSuggestions {
  readonly suggestions: readonly AutoeditSuggestionView[];
  readonly dropped: number;
}

/** A proposal that passed the checks of its own, with the draft suggestion it revises. */
interface Candidate {
  readonly suggestion: ProposedSuggestion;
  readonly revises?: AutoeditSuggestionDraftView;
}

/**
 * Keeps the suggestions of an ✨ Autoedit answer that are safe to put in the form (ADR 0125,
 * amendment "Autoedit: body and suggestions") and counts the rest as dropped. A suggestion is
 * kept when its `id` is one of the draft's (each revised once) or absent; it is on lines the
 * prompt showed, inside the file at the head (`checkSuggestionRanges`); it is within
 * `uraSuggestionLimits`; and it overlaps no other suggestion the note would have. Revisions are
 * placed first, against every other draft suggestion as it was and as revised, then new ones in
 * order, against the suggestions the note would then have. A draft suggestion the answer leaves out, or whose revision is dropped, stays as it was:
 * an answer can't remove one. A revision that changes nothing is no change. Pure.
 */
export function checkAutoeditSuggestions(
  proposed: readonly ProposedSuggestion[],
  context: AutoeditSuggestionContext,
): CheckedAutoeditSuggestions {
  const byId = new Map(
    context.existing.map((suggestion, index) => {
      return [noteSuggestionIdFrom(index), suggestion];
    }),
  );
  const revised = new Set<string>();
  const candidates: Candidate[] = [];
  let dropped = 0;
  for (const suggestion of proposed) {
    let revises: AutoeditSuggestionDraftView | undefined;
    if (suggestion.id !== undefined) {
      revises = byId.get(suggestion.id);
      if (revises === undefined || revised.has(revises.key)) {
        dropped += 1;
        continue;
      }
      revised.add(revises.key);
    }
    if (revises !== undefined && isSameSuggestion(revises, suggestion)) {
      continue;
    }
    if (!isAcceptable(suggestion, context)) {
      dropped += 1;
      continue;
    }
    candidates.push({ suggestion, ...(revises !== undefined && { revises }) });
  }
  const placed: Lines[] = [];
  const kept: AutoeditSuggestionView[] = [];
  const revisions = candidates.filter((candidate) => candidate.revises !== undefined);
  for (const { suggestion, revises } of revisions) {
    const others = context.existing.filter((existing) => existing.key !== revises?.key);
    if ([...others, ...placed].some((lines) => isOverlapping(lines, suggestion))) {
      dropped += 1;
      continue;
    }
    placed.push(suggestion);
    kept.push(viewOf(suggestion, revises));
  }
  let count = context.existing.length;
  const additions = candidates.filter((candidate) => candidate.revises === undefined);
  const replaced = new Set(kept.map((suggestion) => suggestion.key));
  const unrevised = context.existing.filter((suggestion) => !replaced.has(suggestion.key));
  for (const { suggestion } of additions) {
    const taken = [...unrevised, ...placed];
    if (
      count >= uraSuggestionLimits.maxSuggestions ||
      taken.some((lines) => isOverlapping(lines, suggestion))
    ) {
      dropped += 1;
      continue;
    }
    count += 1;
    placed.push(suggestion);
    kept.push(viewOf(suggestion, undefined));
  }
  return { suggestions: kept, dropped };
}

/** The lines a suggestion is on. */
type Lines = Pick<ProposedSuggestion, 'path' | 'startLine' | 'endLine'>;

function isSameSuggestion(
  existing: AutoeditSuggestionDraftView,
  proposed: ProposedSuggestion,
): boolean {
  return (
    existing.path === proposed.path &&
    existing.startLine === proposed.startLine &&
    existing.endLine === proposed.endLine &&
    existing.replacement === proposed.replacement
  );
}

/** The checks a suggestion passes on its own: shown lines, the file at the head, the limits. */
function isAcceptable(suggestion: ProposedSuggestion, context: AutoeditSuggestionContext): boolean {
  const { startLine, endLine, replacement } = suggestion;
  const isInsertion = endLine === startLine - 1;
  if (isInsertion && replacement === '') {
    return false;
  }
  if (
    new TextEncoder().encode(replacement).length > uraSuggestionLimits.maxReplacementBytes ||
    !isShown(suggestion, context.shownLines)
  ) {
    return false;
  }
  return checkSuggestionRanges(
    { headSha: context.headSha, suggestions: [suggestion] },
    context.texts,
  ).ok;
}

/**
 * Whether the prompt showed the lines: a replacement's lines all lie in one shown run, and an
 * insertion's place touches one (the line before it or the line it comes before).
 */
function isShown(lines: Lines, shown: readonly ShownLines[]): boolean {
  const runs = shown.filter((run) => run.path === lines.path);
  if (lines.endLine === lines.startLine - 1) {
    return runs.some((run) => run.start <= lines.startLine && lines.startLine <= run.end + 1);
  }
  return runs.some((run) => run.start <= lines.startLine && lines.endLine <= run.end);
}

/**
 * Whether two suggestions overlap as `validateUraItem` rules out: on one path they share a line,
 * insert at the same place, or one inserts between the other's lines.
 */
function isOverlapping(a: Lines, b: Lines): boolean {
  if (a.path !== b.path) {
    return false;
  }
  const isInsertion = (lines: Lines): boolean => lines.endLine === lines.startLine - 1;
  if (isInsertion(a) && isInsertion(b)) {
    return a.startLine === b.startLine;
  }
  if (isInsertion(a)) {
    return b.startLine < a.startLine && a.startLine <= b.endLine;
  }
  if (isInsertion(b)) {
    return a.startLine < b.startLine && b.startLine <= a.endLine;
  }
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function viewOf(
  suggestion: ProposedSuggestion,
  revises: AutoeditSuggestionDraftView | undefined,
): AutoeditSuggestionView {
  const { path, startLine, endLine, replacement } = suggestion;
  return {
    ...(revises !== undefined && { key: revises.key }),
    path,
    startLine,
    endLine,
    replacement,
  };
}
