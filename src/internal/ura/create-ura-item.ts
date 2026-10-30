import type { Result } from '#x/result/result.ts';

import type {
  CommitSha,
  SessionId,
  UraAnchor,
  UraDeps,
  UraItem,
  UraItemError,
  UraItemId,
  UraOrigin,
} from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';
import { validateUraItem } from './validate-ura-item.ts';

/** What a reviewer (or a promotion) supplies; the rest is assigned. */
export interface UraItemDraft {
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  readonly anchor: UraAnchor;
  readonly severity: UraSeverity;
  readonly origin: UraOrigin;
  readonly title: string;
  readonly body: string;
  /** Unified diff text; see `parseSuggestedPatch`. */
  readonly suggestion?: string;
}

/** A new, `staged` item. The title is trimmed; everything else must already be valid. */
export function createUraItem(draft: UraItemDraft, deps: UraDeps): Result<UraItem, UraItemError> {
  const now = Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });
  return validateUraItem({
    id: deps.newId() as UraItemId,
    sessionId: draft.sessionId,
    headSha: draft.headSha,
    anchor: draft.anchor,
    severity: draft.severity,
    origin: draft.origin,
    title: draft.title.trim(),
    body: draft.body,
    suggestion: draft.suggestion,
    status: { kind: 'staged' },
    createdAt: now,
    updatedAt: now,
  });
}
