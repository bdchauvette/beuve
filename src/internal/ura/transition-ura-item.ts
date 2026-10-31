import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import type { UraItem, UraItemError, UraStatus } from './ura-item.ts';
import { validateUraItem } from './validate-ura-item.ts';

/**
 * Moves an item through its lifecycle: `staged` → `addressed` | `withdrawn`, and back to `staged`
 * to undo. `addressed` and `withdrawn` never turn into each other directly, and an item can only
 * be addressed at a head other than the one it was written against.
 */
export function transitionUraItem(
  item: UraItem,
  to: UraStatus,
  now: Temporal.Instant,
): Result<UraItem, UraItemError> {
  const from = item.status.kind;
  if (from === 'staged' && to.kind === 'staged') {
    return err({
      kind: 'invalid-transition',
      from,
      to: to.kind,
      reason: 'the item is already staged',
    });
  }
  if (from !== 'staged' && to.kind !== 'staged') {
    return err({
      kind: 'invalid-transition',
      from,
      to: to.kind,
      reason: `restore the item to staged before marking it ${to.kind}`,
    });
  }
  return validateUraItem({
    ...item,
    suggestion: item.suggestion?.text,
    status: to,
    updatedAt: now.toString({ fractionalSecondDigits: 3 }),
  });
}
