import type { Result } from '#x/result/result.ts';

import type { UraItem, UraItemError, UraSuggestion } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';
import { validateUraItem } from './validate-ura-item.ts';

/** Fields a reviewer can change in the notes list. `suggestions` replaces them all; `[]` removes them. */
export interface UraItemEdit {
  readonly severity?: UraSeverity;
  readonly blocking?: boolean;
  readonly title?: string;
  readonly body?: string;
  readonly suggestions?: readonly UraSuggestion[];
}

/**
 * Applies a reviewer's edit. The anchor, origin and head an item was written against never
 * change; a different location is a different item.
 */
export function editUraItem(
  item: UraItem,
  edit: UraItemEdit,
  now: Temporal.Instant,
): Result<UraItem, UraItemError> {
  return validateUraItem({
    ...item,
    severity: edit.severity ?? item.severity,
    blocking: edit.blocking ?? item.blocking,
    title: edit.title?.trim() ?? item.title,
    body: edit.body ?? item.body,
    suggestions: edit.suggestions ?? item.suggestions,
    updatedAt: now.toString({ fractionalSecondDigits: 3 }),
  });
}
