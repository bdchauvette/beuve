import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import { countUraSeverities } from './count-ura-severities.ts';
import { escapeMarkdownHtml } from './escape-markdown-html.ts';
import { fenceCodeBlock } from './fence-code-block.ts';
import { formatImpactOrigin } from './format-impact-origin.ts';
import { formatUraAnchor } from './format-ura-anchor.ts';
import { formatUraSeverity } from './format-ura-severity.ts';
import type { OutdatedReason, UraArtifact, UraEntry, UraVerdict } from './ura-artifact.ts';
import type { UraAnchor, UraItem } from './ura-item.ts';
import { uraSeverities } from './ura-severities.ts';

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

export interface GithubReviewOptions {
  /**
   * Per path, the head-side spans of the pull request's diff hunks (`newStart` to
   * `newStart + newCount - 1`, against the PR's base, not an interdiff). GitHub rejects the whole
   * review when a comment falls outside them, so with this map such items go into the body.
   */
  readonly commentableRanges?: ReadonlyMap<string, readonly LineSpan[]>;
}

const events: Readonly<Record<UraVerdict, GithubReviewPayload['event']>> = {
  approve: 'APPROVE',
  'request-changes': 'REQUEST_CHANGES',
  comment: 'COMMENT',
};

const verdictLabels: Readonly<Record<UraVerdict, string>> = {
  approve: 'approved',
  'request-changes': 'changes requested',
  comment: 'comments',
};

const outdatedLabels: Readonly<Record<OutdatedReason, string>> = {
  'lines-changed': 'outdated: the lines changed since',
  'file-deleted': 'outdated: the file was deleted after',
  'no-line-mapping': 'outdated: written against',
};

const shortSha = 12;

/**
 * The GitHub pull request review for an artifact. Line items become inline comments on the
 * head (`side: 'RIGHT'`); a patch that replaces exactly the anchored lines becomes a
 * ```` ```suggestion ```` block, any other patch a ```` ```diff ```` block. Whole-file,
 * whole-change and outdated items, and lines outside `commentableRanges`, go into the body.
 * Pure: posting it is the caller's job.
 */
export function buildGithubReview(
  artifact: UraArtifact,
  options: GithubReviewOptions = {},
): GithubReviewPayload {
  const inline: GithubReviewComment[] = [];
  const general: string[] = [];
  for (const entry of artifact.entries) {
    const comment = commentFrom(entry, options.commentableRanges);
    if (comment === undefined) {
      general.push(generalSection(entry, options.commentableRanges));
    } else {
      inline.push(comment);
    }
  }
  return {
    commit_id: artifact.summary.headSha,
    event: events[artifact.verdict.value],
    body: [
      header(artifact),
      ...(general.length === 0 ? [] : ['### Not attached to a line', ...general]),
    ].join('\n\n'),
    comments: inline,
  };
}

function header(artifact: UraArtifact): string {
  const { verdict } = artifact;
  const chosen =
    verdict.source === 'chosen'
      ? ` (the reviewer's verdict; the items alone suggest ${verdictLabels[verdict.derived]})`
      : '';
  const counts = countUraSeverities(artifact.entries);
  const tally = uraSeverities
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${String(counts[severity])} ${formatUraSeverity(severity).toLowerCase()}`)
    .join(', ');
  const summary = `**beuve review: ${verdictLabels[verdict.value]}**${chosen}`;
  return tally === '' ? summary : `${summary}\n\n${tally}.`;
}

function commentFrom(
  { item, placement }: UraEntry,
  ranges: GithubReviewOptions['commentableRanges'],
): GithubReviewComment | undefined {
  if (placement.kind === 'outdated' || placement.anchor.kind !== 'lines') {
    return undefined;
  }
  const { path, startLine, endLine } = placement.anchor;
  if (!isCommentable(path, startLine, endLine, ranges)) {
    return undefined;
  }
  const body = [
    `**${formatUraSeverity(item.severity)}:** ${escapeMarkdownHtml(item.title)}`,
    ...details(item, true),
  ].join('\n\n');
  return startLine === endLine
    ? { path, line: endLine, side: 'RIGHT', body }
    : { path, start_line: startLine, start_side: 'RIGHT', line: endLine, side: 'RIGHT', body };
}

function isCommentable(
  path: string,
  start: number,
  end: number,
  ranges: GithubReviewOptions['commentableRanges'],
): boolean {
  return (
    ranges === undefined ||
    (ranges.get(path) ?? []).some((range) => range.start <= start && end <= range.end)
  );
}

function generalSection(
  { item, placement }: UraEntry,
  ranges: GithubReviewOptions['commentableRanges'],
): string {
  return [
    `#### ${formatUraSeverity(item.severity)}: ${escapeMarkdownHtml(item.title)}`,
    location(item, placement, ranges),
    ...details(item, false),
  ].join('\n\n');
}

function location(
  item: UraItem,
  placement: UraEntry['placement'],
  ranges: GithubReviewOptions['commentableRanges'],
): string {
  if (placement.kind === 'outdated') {
    const label = outdatedLabels[placement.reason];
    return `\`${formatUraAnchor(item.anchor)}\` (${label} ${item.headSha.slice(0, shortSha)})`;
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
      const outside = ranges === undefined ? '' : " (outside the pull request's diff)";
      return `On \`${formatUraAnchor(anchor)}\`${outside}.`;
    }
  }
}

function details(item: UraItem, isInline: boolean): string[] {
  const impact = item.origin.kind === 'impact-finding' ? [formatImpactOrigin(item.origin)] : [];
  const replacement = isInline ? replacementLines(item) : undefined;
  const patch =
    item.suggestion === undefined
      ? []
      : [
          replacement === undefined
            ? fenceCodeBlock('diff', item.suggestion.text)
            : fenceCodeBlock('suggestion', replacement.join('\n')),
        ];
  return [...(item.body.trim() === '' ? [] : [item.body.trim()]), ...impact, ...patch];
}

/**
 * The new text of the anchored lines, when the patch is one hunk whose changes stay inside the
 * anchor and which shows every anchored line, so the lines can be replaced wholesale.
 */
function replacementLines(item: UraItem): string[] | undefined {
  const { suggestion, anchor } = item;
  const hunk = suggestion?.hunks.length === 1 ? suggestion.hunks[0] : undefined;
  if (hunk === undefined || anchor.kind !== 'lines' || !isCovering(hunk, anchor)) {
    return undefined;
  }
  const { startLine, endLine } = anchor;
  const lines: string[] = [];
  let nextOld = hunk.oldStart;
  for (const line of hunk.lines) {
    if (line.kind === 'added') {
      // Insertions directly before or after the anchored lines belong to the replacement.
      if (nextOld >= startLine && nextOld <= endLine + 1) {
        lines.push(line.content);
      }
      continue;
    }
    if (line.kind === 'context' && nextOld >= startLine && nextOld <= endLine) {
      lines.push(line.content);
    }
    nextOld += 1;
  }
  return lines;
}

function isCovering(
  hunk: { readonly oldStart: number; readonly oldCount: number },
  anchor: Extract<UraAnchor, { kind: 'lines' }>,
): boolean {
  return (
    hunk.oldCount > 0 &&
    hunk.oldStart <= anchor.startLine &&
    hunk.oldStart + hunk.oldCount - 1 >= anchor.endLine
  );
}
