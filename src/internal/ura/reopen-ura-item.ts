import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import type { UraItem, UraItemError } from './ura-item.ts';
import { withUraStatus } from './with-ura-status.ts';

/** Puts a closed note, withdrawn or addressed, back among the staged ones it exports with. */
export function reopenUraItem(item: UraItem, now: Temporal.Instant): Result<UraItem, UraItemError> {
  if (item.status.kind === 'staged') {
    return err({
      kind: 'invalid-transition',
      from: 'staged',
      to: 'staged',
      reason: 'the item is already staged',
    });
  }
  return withUraStatus(item, { kind: 'staged' }, now);
}
