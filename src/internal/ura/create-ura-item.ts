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
  UraSuggestionDraft,
} from './ura-item.ts';
import { uraSuggestionsFromDrafts } from './ura-suggestions-from-drafts.ts';
import type { UraSeverity } from './ura-severities.ts';
import { validateUraItem } from './validate-ura-item.ts';

/** What a reviewer (or a promotion) supplies; the rest is assigned. */
export interface UraItemDraft {
  readonly sessionId: SessionId;
  readonly headSha: CommitSha;
  readonly anchor: UraAnchor;
  readonly severity: UraSeverity;
  readonly blocking: boolean;
  readonly origin: UraOrigin;
  readonly title: string;
  readonly body: string;
  /** None by default; each gets a fresh id. */
  readonly suggestions?: readonly UraSuggestionDraft[];
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
    blocking: draft.blocking,
    origin: draft.origin,
    title: draft.title.trim(),
    body: draft.body,
    suggestions: uraSuggestionsFromDrafts({ drafts: draft.suggestions ?? [], existing: [] }, deps),
    status: { kind: 'staged' },
    createdAt: now,
    updatedAt: now,
  });
}
