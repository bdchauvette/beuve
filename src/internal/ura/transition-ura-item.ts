import { err } from '#pkg/result/err.ts';
import type { Result } from '#pkg/result/result.ts';

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
  now: Date,
): Result<UraItem, UraItemError> {
  const from = item.status.kind;
  const isAllowed = from === 'staged' ? to.kind !== 'staged' : to.kind === 'staged';
  if (!isAllowed) {
    return err({
      kind: 'invalid-transition',
      from,
      to: to.kind,
      reason:
        from === 'staged'
          ? 'the item is already staged'
          : `restore the item to staged before marking it ${to.kind}`,
    });
  }
  return validateUraItem({
    ...item,
    suggestion: item.suggestion?.text,
    status: to,
    updatedAt: now.toISOString(),
  });
}
