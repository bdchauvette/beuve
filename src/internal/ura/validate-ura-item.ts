import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { UraAnchor, UraItem, UraItemError, UraOrigin, UraSuggestion } from './ura-item.ts';

/** An item as callers and rows describe it, not yet checked. */
export type UraItemCandidate = UraItem;

const maxTitleLength = 200;
const maxSuggestions = 500;
const maxReplacementBytes = 64 * 1024;

/**
 * The one gate every item passes, whether built by a constructor, edited or read from a row:
 * the anchor is a sane repository-relative location, the origin's facts are well-formed and fit
 * the anchor, the title (optional) is one short line, the item says something (a title, a body or
 * a suggestion), its suggestions are on sane paths and lines, never overlap, number at most 500
 * and replace with at most 64 KiB each (ADR 0162), and an item is never `addressed` at the head it
 * was written against. Whether a suggestion's lines exist at the head is main's to check: the
 * domain reads no files.
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
    candidate.suggestions.length === 0
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
  const suggestions = checkSuggestions(candidate.suggestions);
  if (suggestions !== undefined) {
    return err({ kind: 'invalid-suggestion', reason: suggestions });
  }
  return ok(candidate);
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
      const confidence = checkConfidence(origin);
      if (confidence !== undefined) {
        return confidence;
      }
      if (anchor.kind === 'lines') {
        return undefined;
      }
      return 'a review finding or proposed note is anchored to lines';
    }
  }
}

function checkConfidence(origin: Extract<UraOrigin, { kind: 'chat-answer' }>): string | undefined {
  const { confidence } = origin;
  if (confidence === undefined) {
    return undefined;
  }
  if (origin.finding === undefined) {
    return 'only a review finding has a confidence';
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return 'the confidence is not between 0 and 1';
  }
  return undefined;
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

function checkSuggestions(suggestions: readonly UraSuggestion[]): string | undefined {
  if (suggestions.length > maxSuggestions) {
    return `a note has at most ${String(maxSuggestions)} suggestions`;
  }
  for (const suggestion of suggestions) {
    const reason = checkSuggestion(suggestion);
    if (reason !== undefined) {
      return reason;
    }
  }
  if (hasOverlap(suggestions)) {
    return 'suggestions of one note must not overlap';
  }
  return undefined;
}

function checkSuggestion(suggestion: UraSuggestion): string | undefined {
  const { path, startLine, endLine, replacement } = suggestion;
  const pathReason = checkPath(path);
  if (pathReason !== undefined) {
    return `a suggestion's path: ${pathReason}`;
  }
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1) {
    return "a suggestion's lines must be positive integers";
  }
  if (endLine < startLine - 1) {
    return "a suggestion's end line comes before its start line";
  }
  if (new TextEncoder().encode(replacement).length > maxReplacementBytes) {
    return `a suggestion replaces with at most ${String(maxReplacementBytes / 1024)} KiB`;
  }
  if (replacement === '' && endLine === startLine - 1) {
    return 'an insertion adds at least one line';
  }
  return undefined;
}

/**
 * Whether any two suggestions on a path overlap: they share a line, insert at the same place, or
 * one inserts between the other's lines. An insertion right before or after a replacement's lines
 * only touches it. In order of position an insertion before line `p` comes before a replacement
 * starting at `p`, so each suggestion is checked against the furthest replacement end and the last
 * insertion before it.
 */
function hasOverlap(suggestions: readonly UraSuggestion[]): boolean {
  const ordered = suggestions.toSorted((a, b) => {
    return a.path.localeCompare(b.path) || a.startLine - b.startLine || a.endLine - b.endLine;
  });
  let path: string | undefined;
  let furthestEnd = 0;
  let lastInsertion = 0;
  for (const { path: next, startLine, endLine } of ordered) {
    if (next !== path) {
      path = next;
      furthestEnd = 0;
      lastInsertion = 0;
    }
    if (endLine === startLine - 1) {
      if (startLine === lastInsertion || startLine <= furthestEnd) {
        return true;
      }
      lastInsertion = startLine;
      continue;
    }
    if (startLine <= furthestEnd) {
      return true;
    }
    furthestEnd = Math.max(furthestEnd, endLine);
  }
  return false;
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
