import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import { escapeMarkdownHtml } from './escape-markdown-html.ts';
import { fenceCodeBlock } from './fence-code-block.ts';
import { formatUraAnchor } from './format-ura-anchor.ts';
import { parseSuggestedPatch } from './parse-suggested-patch.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';
import type {
  OutdatedReason,
  UraArtifact,
  UraEntry,
  UraPlacedSuggestion,
  UraVerdict,
} from './ura-artifact.ts';
import type { UraAnchor, UraItem, UraItemId, UraOrigin, UraSuggestion } from './ura-item.ts';
import type { UraPostingPiece, UraPostingPlacement } from './ura-posting.ts';

/** One inline comment of a review; `start_*` are present only for multi-line ranges. */
export type GithubReviewComment = {
  readonly path: string;
  readonly line: number;
  readonly side: 'RIGHT';
  readonly body: string;
} & (
  { readonly start_line?: never } | { readonly start_line: number; readonly start_side: 'RIGHT' }
);

/** The body of `POST /repos/{owner}/{repo}/pulls/{number}/reviews`. */
export interface GithubReviewPayload {
  /** The head the comments' line numbers refer to. */
  readonly commit_id: string;
  readonly event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  readonly body: string;
  readonly comments: readonly GithubReviewComment[];
}

/** A 1-based, inclusive span of head lines. */
export interface LineSpan {
  readonly start: number;
  readonly end: number;
}

/** What a permalink names in the pull request's repository: a file at a commit, maybe lines. */
export interface GithubPermalinkTarget {
  readonly sha: string;
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

/** One piece of a note, its text or one of its suggestions, named with the note's id. */
export interface GithubReviewPiece {
  readonly itemId: UraItemId;
  readonly piece: UraPostingPiece;
}

/** Where the review put one piece; `comment` indexes its inline comment, when it went in one. */
export interface GithubReviewPlacement extends GithubReviewPiece {
  readonly placement: UraPostingPlacement;
  readonly comment?: number;
}

/** A review to post, and where each piece of each note went in it. */
export interface GithubReview {
  readonly payload: GithubReviewPayload;
  /** Every piece the payload carries. A piece whose section the body had no room for is not here. */
  readonly placements: readonly GithubReviewPlacement[];
  /** How many notes have a `<details>` section in the body. */
  readonly bodySections: number;
  /** How many pieces were left out of the body for length (GitHub's 65,536 characters). */
  readonly leftOut: number;
}

export interface GithubReviewOptions {
  /**
   * Per path, the head-side spans of the pull request's diff hunks (`newStart` to
   * `newStart + newCount - 1`, against the PR's base, not an interdiff). GitHub rejects the whole
   * review when a comment falls outside them, so with this map such pieces go into the body.
   */
  readonly commentableRanges?: ReadonlyMap<string, readonly LineSpan[]>;
  /** The reviewer's own text for the top of the body; none by default (the reviewer writes it). */
  readonly summary?: string;
  /**
   * The permalink to a file or lines in the pull request's base repository; without it (a local
   * session's copy) the body links nothing.
   */
  readonly permalinkFor?: (target: GithubPermalinkTarget) => string;
  /** Pieces an earlier posted review carried; they are left out. */
  readonly posted?: readonly GithubReviewPiece[];
  /** Pieces to put in the body even where they could be inline (GitHub refused their comments). */
  readonly moveToBody?: readonly GithubReviewPiece[];
}

/** GitHub refuses a review body or a comment longer than this. */
const maxLength = 65_536;

const events: Readonly<Record<UraVerdict, GithubReviewPayload['event']>> = {
  approve: 'APPROVE',
  'request-changes': 'REQUEST_CHANGES',
  comment: 'COMMENT',
};

const verdictLabels: Readonly<Record<UraVerdict, string>> = {
  approve: 'Approved',
  'request-changes': 'Changes requested',
  comment: 'Comments',
};

const outdatedLabels: Readonly<Record<OutdatedReason, string>> = {
  'lines-changed': 'outdated: the lines changed since',
  'file-deleted': 'outdated: the file was deleted after',
  'no-line-mapping': 'outdated: written against',
};

const shortSha = 12;

const notePiece: UraPostingPiece = { kind: 'note' };

/** What one note's pieces become, before the body is assembled. */
interface EntryPlan {
  readonly comments: readonly PlannedComment[];
  readonly section?: Section;
}

interface PlannedComment {
  readonly comment: GithubReviewComment;
  readonly pieces: readonly UraPostingPiece[];
  readonly placement: 'comment' | 'suggestion-comment';
}

/** A note's `<details>` block and the pieces in it. */
interface Section {
  readonly itemId: UraItemId;
  readonly text: string;
  readonly pieces: readonly UraPostingPiece[];
}

/** What every piece's placement reads. */
interface PlanContext {
  readonly headSha: string;
  readonly options: GithubReviewOptions;
  readonly posted: ReadonlySet<string>;
  readonly moved: ReadonlySet<string>;
}

/** The lines a suggestion comment sits on, and the text that replaces them. */
interface CommentTarget {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly lines: readonly string[];
}

/** The text of the lines directly around an insertion, when its patch shows them. */
interface Neighbors {
  readonly before?: string;
  readonly after?: string;
}

/** The body text, and how many of the sections it kept. */
interface AssembledBody {
  readonly text: string;
  readonly kept: number;
}

/**
 * The GitHub pull request review for an artifact (ADR 0039, 0162), each piece of each note placed
 * on its own. A note's comment goes inline on its lines (`side: 'RIGHT'`) when they are current
 * and inside `commentableRanges`, with a suggestion over exactly those lines condensed into it as a
 * ```` ```suggestion ```` block. Every other suggestion GitHub can take (current, inside the
 * ranges, and for an insertion a line beside it to hang on) is an inline comment of its own,
 * headed "Suggestion n of m for **title**". Everything else goes into the review body under the
 * reviewer's summary: one `<details>` per note in note order, its headline as the `<summary>`,
 * then the note's text if it isn't inline and each remaining suggestion as a ```` ```diff ````
 * block, each line-anchored piece preceded by a `permalinkFor` link on its own line. A comment
 * over GitHub's 65,536 characters goes to the body instead; a body over it leaves out whole
 * sections from the end and says how many pieces are only in the exported review. GitHub refuses
 * a comment or a change request that says nothing, so such a review's body falls back to the
 * verdict's name. A note the agent raised ends each of its comments and its section with a rule
 * and `_Generated by agent review. Confidence: 50%_` (ADR 0143). Pure: posting it is the caller's
 * job.
 */
export function buildGithubReview(
  artifact: UraArtifact,
  options: GithubReviewOptions = {},
): GithubReview {
  const context: PlanContext = {
    headSha: artifact.summary.headSha,
    options,
    posted: new Set((options.posted ?? []).map((piece) => pieceKey(piece))),
    moved: new Set((options.moveToBody ?? []).map((piece) => pieceKey(piece))),
  };
  const comments: GithubReviewComment[] = [];
  const placements: GithubReviewPlacement[] = [];
  const sections: Section[] = [];
  for (const entry of artifact.entries) {
    const plan = planEntry(entry, context);
    for (const planned of plan.comments) {
      for (const piece of planned.pieces) {
        placements.push({
          itemId: entry.item.id,
          piece,
          placement: planned.placement,
          comment: comments.length,
        });
      }
      comments.push(planned.comment);
    }
    if (plan.section !== undefined) {
      sections.push(plan.section);
    }
  }
  const body = assembleBody(options.summary?.trim() ?? '', sections);
  const kept = sections.slice(0, body.kept);
  for (const section of kept) {
    for (const piece of section.pieces) {
      placements.push({ itemId: section.itemId, piece, placement: 'body' });
    }
  }
  let text = body.text;
  const verdict = artifact.verdict.value;
  if (verdict !== 'approve' && text === '' && comments.length === 0) {
    text = verdictLabels[verdict];
  }
  return {
    payload: {
      commit_id: artifact.summary.headSha,
      event: events[verdict],
      body: text,
      comments,
    },
    placements,
    bodySections: kept.length,
    leftOut: sections.slice(body.kept).flatMap((section) => section.pieces).length,
  };
}

function pieceKey({ itemId, piece }: GithubReviewPiece): string {
  if (piece.kind === 'note') {
    return `${itemId}\0note`;
  }
  return `${itemId}\0${piece.suggestionId}`;
}

/** Places each piece of one note that is still to be posted. */
function planEntry(entry: UraEntry, context: PlanContext): EntryPlan {
  const { item } = entry;
  const isPending = (piece: UraPostingPiece): boolean => {
    return !context.posted.has(pieceKey({ itemId: item.id, piece }));
  };
  const comments: PlannedComment[] = [];
  let isNoteInBody = false;
  let condensed: number | undefined;
  if (isPending(notePiece)) {
    const noteComment = noteCommentFrom(entry, context);
    if (noteComment === undefined) {
      isNoteInBody = true;
    } else {
      comments.push(noteComment);
      condensed = condensedPosition(entry, noteComment);
    }
  }
  const inBody: number[] = [];
  for (const [position, placed] of entry.suggestions.entries()) {
    if (position === condensed || !isPending(suggestionPiece(placed))) {
      continue;
    }
    const comment = suggestionCommentFrom(entry, position, context);
    if (comment === undefined) {
      inBody.push(position);
    } else {
      comments.push(comment);
    }
  }
  if (!isNoteInBody && inBody.length === 0) {
    return { comments };
  }
  return { comments, section: sectionFrom(entry, { isNoteInBody, positions: inBody }, context) };
}

function condensedPosition(entry: UraEntry, planned: PlannedComment): number | undefined {
  for (const piece of planned.pieces) {
    if (piece.kind === 'suggestion') {
      return entry.suggestions.findIndex(({ suggestion }) => suggestion.id === piece.suggestionId);
    }
  }
  return undefined;
}

function suggestionPiece({ suggestion }: UraPlacedSuggestion): UraPostingPiece {
  return { kind: 'suggestion', suggestionId: suggestion.id };
}

function isMoved(item: UraItem, piece: UraPostingPiece, context: PlanContext): boolean {
  return context.moved.has(pieceKey({ itemId: item.id, piece }));
}

/**
 * The note's own inline comment, when its anchor is current lines GitHub can comment on, with a
 * pending suggestion over exactly those lines condensed into it; none when it would be too long.
 */
function noteCommentFrom(entry: UraEntry, context: PlanContext): PlannedComment | undefined {
  const { item, placement } = entry;
  if (
    placement.kind === 'outdated' ||
    placement.anchor.kind !== 'lines' ||
    isMoved(item, notePiece, context) ||
    !isCommentable(placement.anchor, context.options.commentableRanges)
  ) {
    return undefined;
  }
  const { path, startLine, endLine } = placement.anchor;
  const pieces: UraPostingPiece[] = [notePiece];
  const parts = [headline(item)];
  const body = item.body.trim();
  if (body !== '') {
    parts.push(body);
  }
  const position = entry.suggestions.findIndex((placed) => {
    const piece = suggestionPiece(placed);
    return (
      placed.placement.kind === 'current' &&
      !context.posted.has(pieceKey({ itemId: item.id, piece })) &&
      !isMoved(item, piece, context) &&
      placed.placement.suggestion.path === path &&
      placed.placement.suggestion.startLine === startLine &&
      placed.placement.suggestion.endLine === endLine
    );
  });
  const exact = entry.suggestions[position];
  if (exact !== undefined) {
    pieces.push(suggestionPiece(exact));
    parts.push(suggestionBlock(linesOf(exact.suggestion.replacement)));
  }
  parts.push(...agentFooter(item.origin));
  const text = parts.join('\n\n');
  if (text.length > maxLength) {
    return undefined;
  }
  return {
    comment: commentOn({ path, startLine, endLine }, text),
    pieces,
    placement: 'comment',
  };
}

/** A suggestion's own inline comment, when GitHub can take it there and it isn't too long. */
function suggestionCommentFrom(
  entry: UraEntry,
  position: number,
  context: PlanContext,
): PlannedComment | undefined {
  const placed = entry.suggestions[position];
  if (placed === undefined || isMoved(entry.item, suggestionPiece(placed), context)) {
    return undefined;
  }
  const target = commentTargetOf(entry, placed, context.headSha);
  if (
    target === undefined ||
    !isCommentable({ kind: 'lines', ...target }, context.options.commentableRanges)
  ) {
    return undefined;
  }
  const label = `${suggestionLabel(entry, position)} for **${titleOrLabel(entry.item)}**`;
  const text = [label, suggestionBlock(target.lines), ...agentFooter(entry.item.origin)].join(
    '\n\n',
  );
  if (text.length > maxLength) {
    return undefined;
  }
  return {
    comment: commentOn(target, text),
    pieces: [suggestionPiece(placed)],
    placement: 'suggestion-comment',
  };
}

/**
 * The current lines a suggestion's comment sits on and their new text. An insertion hangs on the
 * line before it, which re-anchoring keeps unchanged, or, at the top of a file written against
 * this very head, on the line after it; either line's text comes from the derived patch.
 */
function commentTargetOf(
  entry: UraEntry,
  placed: UraPlacedSuggestion,
  headSha: string,
): CommentTarget | undefined {
  if (placed.placement.kind === 'outdated') {
    return undefined;
  }
  const { path, startLine, endLine, replacement } = placed.placement.suggestion;
  const lines = linesOf(replacement);
  if (endLine >= startLine) {
    return { path, startLine, endLine, lines };
  }
  const neighbors = neighborsOf(placed);
  if (startLine > 1 && neighbors.before !== undefined) {
    return { path, startLine: endLine, endLine, lines: [neighbors.before, ...lines] };
  }
  if (startLine === 1 && entry.item.headSha === headSha && neighbors.after !== undefined) {
    return { path, startLine: 1, endLine: 1, lines: [...lines, neighbors.after] };
  }
  return undefined;
}

/** The context lines directly before and after an insertion, read from its derived patch. */
function neighborsOf({ suggestion, patch }: UraPlacedSuggestion): Neighbors {
  if (patch === undefined) {
    return {};
  }
  const parsed = parseSuggestedPatch(patch, { kind: 'file', path: suggestion.path });
  if (!parsed.ok) {
    return {};
  }
  const lines = parsed.value.hunks[0]?.lines ?? [];
  const first = lines.findIndex((line) => line.kind === 'added');
  if (first === -1) {
    return {};
  }
  const last = lines.findLastIndex((line) => line.kind === 'added');
  const before = lines[first - 1];
  const after = lines[last + 1];
  return {
    ...(before?.kind === 'context' && { before: before.content }),
    ...(after?.kind === 'context' && { after: after.content }),
  };
}

function commentOn(
  { path, startLine, endLine }: Pick<CommentTarget, 'path' | 'startLine' | 'endLine'>,
  body: string,
): GithubReviewComment {
  if (startLine === endLine) {
    return { path, line: endLine, side: 'RIGHT', body };
  }
  return { path, start_line: startLine, start_side: 'RIGHT', line: endLine, side: 'RIGHT', body };
}

/** A suggestion's new lines: `''` is none, so the block deletes the lines it is on. */
function linesOf(replacement: string): string[] {
  if (replacement === '') {
    return [];
  }
  return replacement.split('\n');
}

function suggestionBlock(lines: readonly string[]): string {
  return fenceCodeBlock({ info: 'suggestion', content: lines.join('\n') });
}

/** `Suggestion 2 of 3`, or just `Suggestion` when the note has one. */
function suggestionLabel({ suggestions }: UraEntry, position: number): string {
  if (suggestions.length === 1) {
    return 'Suggestion';
  }
  return `Suggestion ${String(position + 1)} of ${String(suggestions.length)}`;
}

/** The note's title, escaped, or its label when it has none. */
function titleOrLabel(item: UraItem): string {
  const title = escapeMarkdownHtml(item.title);
  if (title === '') {
    return labelOf(item);
  }
  return title;
}

/**
 * The emoji and the Conventional Comments label with its decoration, then the title when there is
 * one: `🎉 **praise:** Nice.`, `⚠️ **issue (blocking):** Guard it.` (ADR 0131).
 */
function headline(item: UraItem): string {
  const emoji = uraSeverityEmoji(item.severity);
  const title = escapeMarkdownHtml(item.title);
  if (title === '') {
    return `${emoji} **${labelOf(item)}**`;
  }
  return `${emoji} **${labelOf(item)}:** ${title}`;
}

/** The headline as plain text for a `<summary>`, where GitHub renders no Markdown. */
function summaryHeadline(item: UraItem): string {
  const emoji = uraSeverityEmoji(item.severity);
  if (item.title === '') {
    return `${emoji} ${labelOf(item)}`;
  }
  return escapeMarkdownHtml(`${emoji} ${labelOf(item)}: ${item.title}`);
}

function labelOf(item: UraItem): string {
  if (item.blocking) {
    return `${item.severity} (blocking)`;
  }
  return item.severity;
}

function isCommentable(
  { path, startLine, endLine }: Extract<UraAnchor, { kind: 'lines' }>,
  ranges: GithubReviewOptions['commentableRanges'],
): boolean {
  return (
    ranges === undefined ||
    (ranges.get(path) ?? []).some((range) => range.start <= startLine && endLine <= range.end)
  );
}

/** What of a note goes in its body section: its text, and which suggestions. */
interface SectionContent {
  readonly isNoteInBody: boolean;
  readonly positions: readonly number[];
}

/**
 * The note's `<details>` block: the headline as its summary, then the note's text when it isn't
 * inline, then each suggestion, with blank lines around every fence so GitHub renders the
 * Markdown inside the HTML block.
 */
function sectionFrom(
  entry: UraEntry,
  { isNoteInBody, positions }: SectionContent,
  context: PlanContext,
): Section {
  const { item } = entry;
  const pieces: UraPostingPiece[] = [];
  const parts = [`<details>\n<summary>${summaryHeadline(item)}</summary>`];
  if (isNoteInBody) {
    pieces.push(notePiece);
    parts.push(...noteParts(entry, context));
  }
  for (const position of positions) {
    const placed = entry.suggestions[position];
    if (placed === undefined) {
      continue;
    }
    pieces.push(suggestionPiece(placed));
    parts.push(...suggestionParts(entry, position, context));
  }
  parts.push(...agentFooter(item.origin), '</details>');
  return { itemId: item.id, text: parts.join('\n\n'), pieces };
}

/** The note's permalink, where it is, and its text. */
function noteParts(entry: UraEntry, context: PlanContext): string[] {
  const { item, placement } = entry;
  const parts: string[] = [];
  const link = notePermalink(entry, context);
  if (link !== undefined) {
    parts.push(link);
  }
  parts.push(noteLocation(item, placement, context.options.commentableRanges));
  const body = item.body.trim();
  if (body !== '') {
    parts.push(body);
  }
  return parts;
}

function notePermalink(entry: UraEntry, context: PlanContext): string | undefined {
  const { permalinkFor } = context.options;
  const { item, placement } = entry;
  if (permalinkFor === undefined) {
    return undefined;
  }
  let sha = context.headSha;
  let anchor = item.anchor;
  if (placement.kind === 'current') {
    anchor = placement.anchor;
  } else {
    sha = item.headSha;
  }
  switch (anchor.kind) {
    case 'change': {
      return undefined;
    }
    case 'file': {
      return permalinkFor({ sha, path: anchor.path });
    }
    case 'lines': {
      const { path, startLine, endLine } = anchor;
      return permalinkFor({ sha, path, startLine, endLine });
    }
  }
}

function noteLocation(
  item: UraItem,
  placement: UraEntry['placement'],
  ranges: GithubReviewOptions['commentableRanges'],
): string {
  if (placement.kind === 'outdated') {
    return `\`${formatUraAnchor(item.anchor)}\` (${outdatedText(placement.reason, item)}).`;
  }
  const { anchor } = placement;
  switch (anchor.kind) {
    case 'change': {
      return 'On the whole change.';
    }
    case 'file': {
      return `On \`${revealFormatControls(anchor.path)}\`.`;
    }
    case 'lines': {
      let outside = '';
      if (!isCommentable(anchor, ranges)) {
        outside = " (outside the pull request's diff)";
      }
      return `On \`${formatUraAnchor(anchor)}\`${outside}.`;
    }
  }
}

function outdatedText(reason: OutdatedReason, item: UraItem): string {
  return `${outdatedLabels[reason]} ${item.headSha.slice(0, shortSha)}`;
}

/** A suggestion's permalink, which lines it changes, and its patch. */
function suggestionParts(entry: UraEntry, position: number, context: PlanContext): string[] {
  const { item } = entry;
  const placed = entry.suggestions[position];
  if (placed === undefined) {
    return [];
  }
  const label = suggestionLabel(entry, position);
  let shown = placed.suggestion;
  let sha: string = item.headSha;
  let note = '';
  if (placed.placement.kind === 'current') {
    shown = placed.placement.suggestion;
    sha = context.headSha;
    const { path, startLine, endLine } = shown;
    const ranges = context.options.commentableRanges;
    if (
      endLine >= startLine &&
      !isCommentable({ kind: 'lines', path, startLine, endLine }, ranges)
    ) {
      note = " (outside the pull request's diff)";
    }
  } else {
    note = ` (${outdatedText(placed.placement.reason, item)})`;
  }
  const parts: string[] = [];
  const link = context.options.permalinkFor?.({ sha, path: shown.path, ...linkedLines(shown) });
  if (link !== undefined) {
    parts.push(link);
  }
  parts.push(`${label} ${whereText(shown)}${note}:`, changeBlock(placed));
  return parts;
}

/** The lines a suggestion's link shows: its own, or for an insertion the line it follows. */
function linkedLines({
  startLine,
  endLine,
}: UraSuggestion): Pick<GithubPermalinkTarget, 'startLine' | 'endLine'> {
  if (endLine >= startLine) {
    return { startLine, endLine };
  }
  const line = Math.max(1, endLine);
  return { startLine: line, endLine: line };
}

function whereText({ path, startLine, endLine }: UraSuggestion): string {
  if (endLine >= startLine) {
    return `on \`${formatUraAnchor({ kind: 'lines', path, startLine, endLine })}\``;
  }
  return `inserting before \`${formatUraAnchor({ kind: 'lines', path, startLine, endLine: startLine })}\``;
}

/** A suggestion's derived patch, or its new text when there is no patch to show. */
function changeBlock({ suggestion, patch }: UraPlacedSuggestion): string {
  if (patch !== undefined) {
    return fenceCodeBlock({ info: 'diff', content: patch });
  }
  return fenceCodeBlock({ info: '', content: suggestion.replacement });
}

/**
 * The summary, then the sections; when that is over GitHub's limit, whole sections are left out
 * from the end and a last line says how many notes and suggestions only the exported review has.
 */
function assembleBody(summary: string, sections: readonly Section[]): AssembledBody {
  const lead: string[] = [];
  if (summary !== '') {
    lead.push(summary);
  }
  let kept = sections.length;
  let text = [...lead, ...sections.map((section) => section.text)].join('\n\n');
  while (text.length > maxLength && kept > 0) {
    kept -= 1;
    const shown = sections.slice(0, kept).map((section) => section.text);
    text = [...lead, ...shown, leftOutLine(sections.slice(kept))].join('\n\n');
  }
  return { text, kept };
}

function leftOutLine(sections: readonly Section[]): string {
  const pieces = sections.flatMap((section) => section.pieces);
  const notes = pieces.filter((piece) => piece.kind === 'note').length;
  const suggestions = pieces.length - notes;
  const counts: string[] = [];
  if (notes > 0) {
    counts.push(countText(notes, 'note'));
  }
  if (suggestions > 0) {
    counts.push(countText(suggestions, 'suggestion'));
  }
  let verb = 'are';
  if (pieces.length === 1) {
    verb = 'is';
  }
  return `_${counts.join(' and ')} ${verb} in the exported review._`;
}

function countText(count: number, noun: string): string {
  if (count === 1) {
    return `1 more ${noun}`;
  }
  return `${String(count)} more ${noun}s`;
}

/** Says the agent raised the note, and how sure it was when the note is a finding that says. */
function agentFooter(origin: UraOrigin): string[] {
  if (origin.kind !== 'chat-answer') {
    return [];
  }
  if (origin.confidence === undefined) {
    return ['---', '_Generated by agent review._'];
  }
  return [
    '---',
    `_Generated by agent review. Confidence: ${String(Math.round(origin.confidence * 100))}%_`,
  ];
}
