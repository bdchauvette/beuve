import type { Result } from '#x/result/result.ts';

import type { UraItem, UraItemError, UraStatus } from './ura-item.ts';
import { validateUraItem } from './validate-ura-item.ts';

/**
 * The item in `status` as of `now`, validated (so never addressed at the head it was written
 * against). The status actions decide whether the change is allowed; this only builds it.
 */
export function withUraStatus(
  item: UraItem,
  status: UraStatus,
  now: Temporal.Instant,
): Result<UraItem, UraItemError> {
  return validateUraItem({
    ...item,
    status,
    updatedAt: now.toString({ fractionalSecondDigits: 3 }),
  });
}
