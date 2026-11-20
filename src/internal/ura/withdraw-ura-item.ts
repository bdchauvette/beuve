import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import type { UraItem, UraItemError } from './ura-item.ts';
import { withUraStatus } from './with-ura-status.ts';

/**
 * The reviewer drops the note: it is no longer exported. Works from staged and from addressed,
 * since a note judged fixed can still turn out not to be worth saying (ADR 0151).
 */
export function withdrawUraItem(
  item: UraItem,
  now: Temporal.Instant,
): Result<UraItem, UraItemError> {
  if (item.status.kind === 'withdrawn') {
    return err({
      kind: 'invalid-transition',
      from: 'withdrawn',
      to: 'withdrawn',
      reason: 'the item is already withdrawn',
    });
  }
  return withUraStatus(item, { kind: 'withdrawn' }, now);
}
