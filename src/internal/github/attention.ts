/**
 * Whose turn a pull request is (ADR 0066): `you` (the signed-in user must act), `author`,
 * `reviewers`, or `unknown` (closed, merged, or nothing is waiting on anyone). `reasons` are short
 * sentences, most decisive first, for a hover.
 */
export interface Attention {
  readonly turn: 'you' | 'author' | 'reviewers' | 'unknown';
  readonly reasons: readonly string[];
}
