import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import type { CommitSha, UraItem, UraItemError } from './ura-item.ts';
import { withUraStatus } from './with-ura-status.ts';

/** Who judged a note fixed, at which head, and when. */
export interface UraAddressing {
  readonly atSha: CommitSha;
  readonly by: 'reviewer' | 'agent';
  readonly now: Temporal.Instant;
}

/**
 * A reviewer or an agent judges the note fixed at `atSha`, which must be a later head than the
 * one it was written against. Works from staged and from withdrawn, since a dropped note can
 * turn out to have been fixed after all (ADR 0151).
 */
export function markUraItemAddressed(
  item: UraItem,
  { atSha, by, now }: UraAddressing,
): Result<UraItem, UraItemError> {
  if (item.status.kind === 'addressed') {
    return err({
      kind: 'invalid-transition',
      from: 'addressed',
      to: 'addressed',
      reason: 'the item is already addressed',
    });
  }
  return withUraStatus(item, { kind: 'addressed', atSha, by }, now);
}
