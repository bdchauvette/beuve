import type { ChatMentionView } from '#contract/ipc-contract.ts';

/**
 * The chat input's content as a model (ADR 0046): text runs and atomic mention chips, in order.
 * The drawer renders it into its editable box and reads it back; a chip counts as one position.
 */
export type DraftPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'mention'; readonly mention: ChatMentionView };

/** A draft and a caret in it: a position from 0 to the draft's length, a chip being one. */
export interface DraftState {
  readonly parts: readonly DraftPart[];
  readonly caret: number;
}

/** A mention without its commit, as a card, the dock or the tree names it; the shell adds the sha. */
export type MentionTarget = Omit<ChatMentionView, 'sha'>;
