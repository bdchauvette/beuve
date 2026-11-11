import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

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
 * the anchor, the title (optional) is one short line, the item says something (a title, a body or
 * a patch), the patch fits the anchor, and an item is never
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
  if (
    candidate.title === '' &&
    candidate.body.trim() === '' &&
    candidate.suggestion === undefined
  ) {
    return err({ kind: 'invalid-text', reason: 'a note needs a title, a body or a suggestion' });
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
  if (suggestion.ok) {
    return ok({ ...candidate, suggestion: suggestion.value });
  }
  return suggestion;
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
  if (endLine < startLine) {
    return 'the end line comes before the start line';
  }
  return undefined;
}

function checkPath(path: string): string | undefined {
  if (path === '' || hasControlCharacter(path)) {
    return 'the path is empty or contains control characters';
  }
  const segments = path.split('/');
  const hasBadSegment = segments.some((segment) => {
    return ['', '.', '..'].includes(segment);
  });
  if (hasBadSegment) {
    return 'the path must be repository-relative, without empty, . or .. segments';
  }
  return undefined;
}

function checkOrigin(origin: UraOrigin, anchor: UraAnchor): string | undefined {
  switch (origin.kind) {
    case 'human': {
      return undefined;
    }
    case 'chat-answer': {
      if (origin.messageId.trim() === '') {
        return 'the chat message id is empty';
      }
      if (origin.finding !== undefined && origin.proposal !== undefined) {
        return 'an item comes from a finding or a proposed note, not both';
      }
      const index = origin.finding ?? origin.proposal;
      if (index === undefined) {
        return 'a chat item is a review finding or a proposed note';
      }
      if (!Number.isSafeInteger(index) || index < 0) {
        return 'the finding or proposal index is not a non-negative integer';
      }
      if (anchor.kind === 'lines') {
        return undefined;
      }
      return 'a review finding or proposed note is anchored to lines';
    }
  }
}

function checkTitle(title: string): string | undefined {
  if (title !== title.trim()) {
    return 'the title must be trimmed';
  }
  if (hasControlCharacter(title)) {
    return 'the title must be a single line';
  }
  if (title.length > maxTitleLength) {
    return `the title must be at most ${String(maxTitleLength)} characters`;
  }
  return undefined;
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
