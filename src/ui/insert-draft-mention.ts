import type { ChatMentionView } from '#contract/ipc-contract.ts';

import type { DraftPart, DraftState } from './chat-draft.ts';

/**
 * Puts a chip at the caret, splitting the text there, with a space on either side unless one is
 * already there, and leaves the caret after the chip and the space that follows it. Adjacent text
 * runs are merged. Pure.
 */
export function insertDraftMention(state: DraftState, mention: ChatMentionView): DraftState {
  const before: DraftPart[] = [];
  const after: DraftPart[] = [];
  let position = 0;
  for (const part of state.parts) {
    const length = part.kind === 'text' ? part.text.length : 1;
    if (position + length <= state.caret) {
      before.push(part);
    } else if (position >= state.caret) {
      after.push(part);
    } else if (part.kind === 'text') {
      const cut = state.caret - position;
      before.push({ kind: 'text', text: part.text.slice(0, cut) });
      after.push({ kind: 'text', text: part.text.slice(cut) });
    }
    position += length;
  }
  const previous = before.at(-1);
  const next = after[0];
  const isSpaceBeforeMissing = previous !== undefined && !isEndingInSpace(previous);
  const isSpaceAfterMissing = next === undefined || !isStartingWithSpace(next);
  const parts = mergeText([
    ...before,
    ...(isSpaceBeforeMissing ? [space] : []),
    { kind: 'mention', mention },
    ...(isSpaceAfterMissing ? [space] : []),
    ...after,
  ]);
  return { parts, caret: length(before) + (isSpaceBeforeMissing ? 1 : 0) + 2 };
}

const space: DraftPart = { kind: 'text', text: ' ' };
const trailingSpace = /\s$/u;
const leadingSpace = /^\s/u;

function isEndingInSpace(part: DraftPart): boolean {
  return part.kind === 'text' && trailingSpace.test(part.text);
}

function isStartingWithSpace(part: DraftPart): boolean {
  return part.kind === 'text' && leadingSpace.test(part.text);
}

function length(parts: readonly DraftPart[]): number {
  return parts.reduce((sum, part) => sum + (part.kind === 'text' ? part.text.length : 1), 0);
}

function mergeText(parts: readonly DraftPart[]): DraftPart[] {
  const merged: DraftPart[] = [];
  for (const part of parts) {
    if (part.kind === 'text' && part.text === '') {
      continue;
    }
    const last = merged.at(-1);
    if (part.kind === 'text' && last?.kind === 'text') {
      merged[merged.length - 1] = { kind: 'text', text: last.text + part.text };
    } else {
      merged.push(part);
    }
  }
  return merged;
}
