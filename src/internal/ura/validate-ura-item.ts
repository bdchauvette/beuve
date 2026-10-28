import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { isUuid } from './is-uuid.ts';
import { parseSuggestedPatch } from './parse-suggested-patch.ts';
import type { UraAnchor, UraItem, UraItemError, UraOrigin } from './ura-item.ts';

/** An item as callers and rows describe it: the suggested patch is still unchecked text. */
export type UraItemCandidate = Omit<UraItem, 'suggestion'> & {
  readonly suggestion: string | undefined;
};

const maxTitleLength = 200;

/**
 * The one gate every item passes, whether built by a constructor, edited or read from a row:
 * the anchor is a sane repository-relative location, the origin's facts are well-formed and fit
 * the anchor, the title is one short line, the patch fits the anchor, and an item is never
 * `addressed` at the head it was written against.
 */
export function validateUraItem(candidate: UraItemCandidate): Result<UraItem, UraItemError> {
  const anchor = checkAnchor(candidate.anchor);
  if (anchor !== undefined) {
    return err({ kind: 'invalid-anchor', reason: anchor });
  }
  const origin = checkOrigin(candidate.origin, candidate.anchor);
  if (origin !== undefined) {
    return err({ kind: 'invalid-origin', reason: origin });
  }
  const title = checkTitle(candidate.title);
  if (title !== undefined) {
    return err({ kind: 'invalid-text', reason: title });
  }
  const { status } = candidate;
  if (status.kind === 'addressed' && status.atSha === candidate.headSha) {
    return err({
      kind: 'invalid-transition',
      from: 'staged',
      to: 'addressed',
      reason: 'an item is addressed at a later head than the one it was written against',
    });
  }
  if (candidate.suggestion === undefined) {
    return ok({ ...candidate, suggestion: undefined });
  }
  const suggestion = parseSuggestedPatch(candidate.suggestion, candidate.anchor);
  return suggestion.ok ? ok({ ...candidate, suggestion: suggestion.value }) : suggestion;
}

function checkAnchor(anchor: UraAnchor): string | undefined {
  if (anchor.kind === 'change') {
    return undefined;
  }
  const path = checkPath(anchor.path);
  if (path !== undefined || anchor.kind === 'file') {
    return path;
  }
  const { startLine, endLine } = anchor;
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1) {
    return 'lines must be positive integers';
  }
  return endLine < startLine ? 'the end line comes before the start line' : undefined;
}

function checkPath(path: string): string | undefined {
  if (path === '' || hasControlCharacter(path)) {
    return 'the path is empty or contains control characters';
  }
  const segments = path.split('/');
  const hasBadSegment = segments.some((segment) => ['', '.', '..'].includes(segment));
  return hasBadSegment
    ? 'the path must be repository-relative, without empty, . or .. segments'
    : undefined;
}

function checkOrigin(origin: UraOrigin, anchor: UraAnchor): string | undefined {
  switch (origin.kind) {
    case 'human': {
      return undefined;
    }
    case 'agent-insight': {
      return isUuid(origin.insightId) ? undefined : 'the insight id is not a UUID';
    }
    case 'chat-answer': {
      return origin.messageId.trim() === '' ? 'the chat message id is empty' : undefined;
    }
    case 'impact-finding': {
      return checkFinding(origin, anchor);
    }
  }
}

function checkFinding(
  origin: Extract<UraOrigin, { kind: 'impact-finding' }>,
  anchor: UraAnchor,
): string | undefined {
  if (anchor.kind !== 'lines') {
    return 'an ImpactGate finding anchors to the lines of its function';
  }
  if (origin.functionName.trim() === '') {
    return 'the function name is empty';
  }
  if (!Number.isFinite(origin.value) || !Number.isFinite(origin.threshold)) {
    return 'the metric value and threshold must be finite numbers';
  }
  const { percentile } = origin;
  return Number.isFinite(percentile) && percentile >= 0 && percentile <= 100
    ? undefined
    : 'the percentile must be between 0 and 100';
}

function checkTitle(title: string): string | undefined {
  if (title.trim() === '' || title !== title.trim()) {
    return 'the title must be non-empty and trimmed';
  }
  if (hasControlCharacter(title)) {
    return 'the title must be a single line';
  }
  return title.length > maxTitleLength
    ? `the title must be at most ${String(maxTitleLength)} characters`
    : undefined;
}

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x7f || code < 0x20) {
      return true;
    }
  }
  return false;
}
