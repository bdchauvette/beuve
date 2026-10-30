import type { AttentionView } from '#contract/ipc-contract.ts';

/** The attention chip: whose turn, and why on hover. */
export interface AttentionChip {
  readonly text: string;
  readonly title: string;
  /** `you` is drawn with the accent; the other turns stay muted. */
  readonly isYours: boolean;
}

const labels: Readonly<Record<Exclude<AttentionView['turn'], 'unknown'>, string>> = {
  you: 'Your turn',
  author: 'Author’s turn',
  reviewers: 'Reviewers’ turn',
};

/**
 * Describes a pull request's attention set (ADR 0066) for the status bar; `undefined` when it is
 * unknown or not read yet, so local sessions and unclear states show nothing. Pure.
 */
export function describeAttention(attention: AttentionView | undefined): AttentionChip | undefined {
  if (attention === undefined || attention.turn === 'unknown') {
    return undefined;
  }
  return {
    text: labels[attention.turn],
    title: [...attention.reasons, 'A heuristic from reviews, requests and CI.'].join('\n'),
    isYours: attention.turn === 'you',
  };
}
