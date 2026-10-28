import type { Result } from '#pkg/result/result.ts';

import type { UraItem, UraItemError } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';
import { validateUraItem } from './validate-ura-item.ts';

/** Fields a reviewer can change in the dock. An empty `suggestion` removes the patch. */
export interface UraItemEdit {
  readonly severity?: UraSeverity;
  readonly title?: string;
  readonly body?: string;
  readonly suggestion?: string;
}

/**
 * Applies a reviewer's edit. The anchor, origin and head an item was written against never
 * change; a different location is a different item.
 */
export function editUraItem(
  item: UraItem,
  edit: UraItemEdit,
  now: Date,
): Result<UraItem, UraItemError> {
  const suggestion = edit.suggestion ?? item.suggestion?.text;
  return validateUraItem({
    ...item,
    severity: edit.severity ?? item.severity,
    title: edit.title?.trim() ?? item.title,
    body: edit.body ?? item.body,
    suggestion: suggestion === '' ? undefined : suggestion,
    updatedAt: now.toISOString(),
  });
}
